import {
  ConflictException,
  ExecutionContext,
  HttpStatus,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import {
  CampaignAudienceType,
  CampaignDispatchType,
  MAX_CAMPAIGN_CUSTOMER_IDS,
} from './dto/dispatch-campaign.dto';

describe('AutomationController campaign dispatch HTTP', () => {
  const authenticatedUser: RequestWithUser['user'] = {
    userId: 'user-1',
    name: 'Owner',
    email: 'owner@example.test',
    companyId: 'company-from-jwt',
    role: UserRole.OWNER,
  };
  const automationId = 'campaign-automation-1';
  const serviceMock = {
    create: jest.fn(),
    findAll: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
    createCampaign: jest.fn(),
    dispatchCampaign: jest.fn(),
    previewCampaignAudience: jest.fn(),
  };
  let app: INestApplication;

  beforeAll(async () => {
    const authenticatedGuard = {
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest<RequestWithUser>().user =
          authenticatedUser;
        return true;
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AutomationController],
      providers: [{ provide: AutomationService, useValue: serviceMock }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authenticatedGuard)
      .overrideGuard(CompanyActiveGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    serviceMock.dispatchCampaign.mockImplementation((id, data, _companyId) => ({
      automationId: id,
      type: data.type,
      audienceType: data.audience.type,
      eligibleCustomers: 2,
      processed: 2,
    }));
    serviceMock.previewCampaignAudience.mockResolvedValue({
      audienceType: CampaignAudienceType.SEGMENTED,
      matched: 4,
      eligible: 3,
      blocked: 1,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const dispatch = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/automation/${automationId}/campaign/dispatch`)
      .send(body);

  const createCampaign = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/automation/campaign').send(body);

  const previewAudience = (body?: Record<string, unknown>) => {
    const operation = request(app.getHttpServer()).post(
      `/automation/${automationId}/campaign/audience-preview`,
    );
    return body === undefined ? operation : operation.send(body);
  };

  it('exige JWT e empresa ativa no controller', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AutomationController,
    ) as unknown[];

    expect(guards).toEqual([JwtAuthGuard, CompanyActiveGuard]);
  });

  it('cria CAMPAIGN com nome e companyId exclusivamente do JWT', async () => {
    serviceMock.createCampaign.mockResolvedValue({
      id: 'campaign-1',
      name: 'Promoção de Inverno',
      type: 'CAMPAIGN',
      daysAfter: null,
      message: null,
      isActive: true,
    });

    const response = await createCampaign({
      name: 'Promoção de Inverno',
    }).expect(HttpStatus.CREATED);

    expect(serviceMock.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Promoção de Inverno' }),
      authenticatedUser.companyId,
    );
    expect(response.body).toEqual(
      expect.objectContaining({
        type: 'CAMPAIGN',
        daysAfter: null,
        message: null,
        isActive: true,
      }),
    );
  });

  it.each([
    'companyId',
    'type',
    'daysAfter',
    'message',
    'cooldownHours',
    'isActive',
  ])('rejeita campo %s na criação pública de campanha', async (field) => {
    await createCampaign({
      name: 'Promoção de Inverno',
      [field]: 'client-controlled-value',
    }).expect(HttpStatus.BAD_REQUEST);

    expect(serviceMock.createCampaign).not.toHaveBeenCalled();
  });

  it('propaga conflito seguro de nome duplicado', async () => {
    serviceMock.createCampaign.mockRejectedValue(
      new ConflictException('Já existe uma campanha com esse nome.'),
    );

    const response = await createCampaign({
      name: 'Promoção de Inverno',
    }).expect(HttpStatus.CONFLICT);

    expect(response.body.message).toBe('Já existe uma campanha com esse nome.');
  });

  it('aceita TEXT ALL_ELIGIBLE, usa companyId do JWT e retorna resumo 202', async () => {
    const body = {
      type: CampaignDispatchType.TEXT,
      content: 'Promoção especial',
      audience: { type: CampaignAudienceType.ALL_ELIGIBLE },
    };

    const response = await dispatch(body).expect(HttpStatus.ACCEPTED);

    expect(serviceMock.dispatchCampaign).toHaveBeenCalledWith(
      automationId,
      expect.objectContaining(body),
      authenticatedUser.companyId,
    );
    expect(response.body).toEqual({
      automationId,
      type: CampaignDispatchType.TEXT,
      audienceType: CampaignAudienceType.ALL_ELIGIBLE,
      eligibleCustomers: 2,
      processed: 2,
    });
  });

  it('aceita TEXT com audiência CUSTOMER_IDS', async () => {
    await dispatch({
      type: CampaignDispatchType.TEXT,
      content: 'Promoção especial',
      audience: {
        type: CampaignAudienceType.CUSTOMER_IDS,
        customerIds: ['customer-1', 'customer-1', 'customer-2'],
      },
    }).expect(HttpStatus.ACCEPTED);

    expect(serviceMock.dispatchCampaign).toHaveBeenCalledTimes(1);
  });

  it('aceita criação SEGMENTED com filtros normalizados pelo DTO', async () => {
    serviceMock.createCampaign.mockResolvedValue({ id: 'campaign-1' });

    await createCampaign({
      name: 'Público PR',
      audienceType: CampaignAudienceType.SEGMENTED,
      segmentCity: '  Curitiba  ',
      segmentState: 'pr',
      segmentMinAge: 18,
      segmentMaxAge: 35,
    }).expect(HttpStatus.CREATED);

    expect(serviceMock.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        audienceType: CampaignAudienceType.SEGMENTED,
        segmentCity: 'Curitiba',
        segmentState: 'PR',
        segmentMinAge: 18,
        segmentMaxAge: 35,
      }),
      authenticatedUser.companyId,
    );
  });

  it.each([
    {
      name: 'Sem filtro',
      audienceType: CampaignAudienceType.SEGMENTED,
    },
    {
      name: 'Filtro em all',
      audienceType: CampaignAudienceType.ALL_ELIGIBLE,
      segmentState: 'PR',
    },
  ])('rejeita configuração de segmentação incoerente', async (body) => {
    await createCampaign(body).expect(HttpStatus.BAD_REQUEST);
    expect(serviceMock.createCampaign).not.toHaveBeenCalled();
  });

  it('aceita dispatch SEGMENTED sem customerIds', async () => {
    await dispatch({
      type: CampaignDispatchType.TEXT,
      content: 'Promoção segmentada',
      audience: { type: CampaignAudienceType.SEGMENTED },
    }).expect(HttpStatus.ACCEPTED);

    expect(serviceMock.dispatchCampaign).toHaveBeenCalledTimes(1);
  });

  it('rejeita SEGMENTED com customerIds', async () => {
    await dispatch({
      type: CampaignDispatchType.TEXT,
      content: 'Promoção segmentada',
      audience: {
        type: CampaignAudienceType.SEGMENTED,
        customerIds: ['customer-1'],
      },
    }).expect(HttpStatus.BAD_REQUEST);

    expect(serviceMock.dispatchCampaign).not.toHaveBeenCalled();
  });

  it('retorna preview 200 com contagens e companyId do JWT', async () => {
    const response = await previewAudience().expect(HttpStatus.OK);

    expect(serviceMock.previewCampaignAudience).toHaveBeenCalledWith(
      automationId,
      authenticatedUser.companyId,
      { audience: undefined },
    );
    expect(response.body).toEqual({
      audienceType: CampaignAudienceType.SEGMENTED,
      matched: 4,
      eligible: 3,
      blocked: 1,
    });
    expect(serviceMock.dispatchCampaign).not.toHaveBeenCalled();
  });

  it('aceita preview CUSTOMER_IDS e preserva companyId do JWT', async () => {
    await previewAudience({
      audience: {
        type: CampaignAudienceType.CUSTOMER_IDS,
        customerIds: [' customer-1 ', 'customer-1', 'customer-2'],
      },
    }).expect(HttpStatus.OK);

    expect(serviceMock.previewCampaignAudience).toHaveBeenCalledWith(
      automationId,
      authenticatedUser.companyId,
      {
        audience: {
          type: CampaignAudienceType.CUSTOMER_IDS,
          customerIds: [' customer-1 ', 'customer-1', 'customer-2'],
        },
      },
    );
  });

  it('rejeita preview CUSTOMER_IDS vazio ou acima de 500 IDs', async () => {
    await previewAudience({
      audience: {
        type: CampaignAudienceType.CUSTOMER_IDS,
        customerIds: [],
      },
    }).expect(HttpStatus.BAD_REQUEST);
    await previewAudience({
      audience: {
        type: CampaignAudienceType.CUSTOMER_IDS,
        customerIds: Array.from(
          { length: MAX_CAMPAIGN_CUSTOMER_IDS + 1 },
          (_, index) => `customer-${index}`,
        ),
      },
    }).expect(HttpStatus.BAD_REQUEST);

    expect(serviceMock.previewCampaignAudience).not.toHaveBeenCalled();
  });

  it('aceita IMAGE somente por mediaAssetId e não expõe dados internos', async () => {
    const response = await dispatch({
      type: CampaignDispatchType.IMAGE,
      mediaAssetId: 'media-asset-1',
      caption: 'Legenda opcional',
      audience: { type: CampaignAudienceType.ALL_ELIGIBLE },
    }).expect(HttpStatus.ACCEPTED);

    expect(serviceMock.dispatchCampaign).toHaveBeenCalledWith(
      automationId,
      expect.objectContaining({
        type: CampaignDispatchType.IMAGE,
        mediaAssetId: 'media-asset-1',
        caption: 'Legenda opcional',
      }),
      authenticatedUser.companyId,
    );
    expect(JSON.stringify(response.body)).not.toMatch(
      /mediaAsset|mediaUrl|bucket|objectKey|storageProvider|token/i,
    );
  });

  it.each(['companyId', 'mediaUrl', 'bucket', 'objectKey', 'storageProvider'])(
    'rejeita campo público não permitido %s',
    async (field) => {
      await dispatch({
        type: CampaignDispatchType.IMAGE,
        mediaAssetId: 'media-asset-1',
        audience: { type: CampaignAudienceType.ALL_ELIGIBLE },
        [field]: 'client-controlled-value',
      }).expect(HttpStatus.BAD_REQUEST);

      expect(serviceMock.dispatchCampaign).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      type: CampaignDispatchType.TEXT,
      audience: { type: CampaignAudienceType.ALL_ELIGIBLE },
    },
    {
      type: CampaignDispatchType.IMAGE,
      audience: { type: CampaignAudienceType.ALL_ELIGIBLE },
    },
    {
      type: CampaignDispatchType.IMAGE,
      mediaAssetId: 'media-asset-1',
      content: 'não permitido',
      audience: { type: CampaignAudienceType.ALL_ELIGIBLE },
    },
  ])('rejeita combinação inválida de payload', async (body) => {
    await dispatch(body).expect(HttpStatus.BAD_REQUEST);
    expect(serviceMock.dispatchCampaign).not.toHaveBeenCalled();
  });

  it.each([
    { ids: [] },
    {
      ids: Array.from(
        { length: MAX_CAMPAIGN_CUSTOMER_IDS + 1 },
        (_, index) => `customer-${index}`,
      ),
    },
  ])(
    'rejeita audiência CUSTOMER_IDS vazia ou acima do limite',
    async ({ ids }) => {
      await dispatch({
        type: CampaignDispatchType.TEXT,
        content: 'Promoção',
        audience: {
          type: CampaignAudienceType.CUSTOMER_IDS,
          customerIds: ids,
        },
      }).expect(HttpStatus.BAD_REQUEST);

      expect(serviceMock.dispatchCampaign).not.toHaveBeenCalled();
    },
    15_000,
  );

  it('rejeita customerId vazio', async () => {
    await dispatch({
      type: CampaignDispatchType.TEXT,
      content: 'Promoção',
      audience: {
        type: CampaignAudienceType.CUSTOMER_IDS,
        customerIds: ['   '],
      },
    }).expect(HttpStatus.BAD_REQUEST);
  });

  it('retorna erro HTTP seguro do domínio', async () => {
    serviceMock.dispatchCampaign.mockRejectedValue(
      new ConflictException('Media asset is not ready'),
    );

    const response = await dispatch({
      type: CampaignDispatchType.IMAGE,
      mediaAssetId: 'media-asset-1',
      audience: { type: CampaignAudienceType.ALL_ELIGIBLE },
    }).expect(HttpStatus.CONFLICT);

    expect(response.body.message).toBe('Media asset is not ready');
    expect(JSON.stringify(response.body)).not.toMatch(
      /bucket|objectKey|credential|signed/i,
    );
  });
});
