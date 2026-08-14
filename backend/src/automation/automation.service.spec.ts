import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AutomationType, CustomerGender, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaAssetEnqueueError } from '../queue/media-asset-enqueue.error';
import { AutomationService } from './automation.service';
import {
  CampaignAudienceType,
  CampaignDispatchType,
  DispatchCampaignDto,
} from './dto/dispatch-campaign.dto';
import { EngineService } from './engine/engine.service';

describe('AutomationService campaign dispatch', () => {
  const engineServiceMock = {
    enqueueCampaign: jest.fn(),
    previewCampaignAudience: jest.fn(),
  };
  const service = new AutomationService(
    {} as PrismaService,
    engineServiceMock as unknown as EngineService,
  );
  const companyId = 'company-from-jwt';
  const automationId = 'campaign-automation-1';

  const textInput = (): DispatchCampaignDto => ({
    type: CampaignDispatchType.TEXT,
    content: '  Promoção especial  ',
    audience: {
      type: CampaignAudienceType.ALL_ELIGIBLE,
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    engineServiceMock.enqueueCampaign.mockResolvedValue({
      eligibleCustomers: 2,
      processed: 2,
    });
    engineServiceMock.previewCampaignAudience.mockResolvedValue({
      audienceType: CampaignAudienceType.SEGMENTED,
      matched: 3,
      eligible: 2,
      blocked: 1,
    });
  });

  it('coordena TEXT para todos os elegíveis com companyId confiável', async () => {
    await expect(
      service.dispatchCampaign(automationId, textInput(), companyId),
    ).resolves.toEqual({
      automationId,
      type: CampaignDispatchType.TEXT,
      audienceType: CampaignAudienceType.ALL_ELIGIBLE,
      eligibleCustomers: 2,
      processed: 2,
    });

    expect(engineServiceMock.enqueueCampaign).toHaveBeenCalledWith(
      companyId,
      automationId,
      {
        audienceType: CampaignAudienceType.ALL_ELIGIBLE,
        customerIds: undefined,
        content: 'Promoção especial',
      },
    );
  });

  it('remove customerIds duplicados e normaliza espaços', async () => {
    await service.dispatchCampaign(
      automationId,
      {
        ...textInput(),
        audience: {
          type: CampaignAudienceType.CUSTOMER_IDS,
          customerIds: [' customer-1 ', 'customer-2', 'customer-1'],
        },
      },
      companyId,
    );

    expect(engineServiceMock.enqueueCampaign).toHaveBeenCalledWith(
      companyId,
      automationId,
      expect.objectContaining({
        customerIds: ['customer-1', 'customer-2'],
      }),
    );
  });

  it('coordena IMAGE somente com mediaAssetId e caption', async () => {
    const result = await service.dispatchCampaign(
      automationId,
      {
        type: CampaignDispatchType.IMAGE,
        mediaAssetId: '  media-asset-1  ',
        caption: 'Legenda opcional',
        audience: {
          type: CampaignAudienceType.ALL_ELIGIBLE,
        },
      },
      companyId,
    );

    expect(engineServiceMock.enqueueCampaign).toHaveBeenCalledWith(
      companyId,
      automationId,
      {
        audienceType: CampaignAudienceType.ALL_ELIGIBLE,
        customerIds: undefined,
        mediaAssetId: 'media-asset-1',
        caption: 'Legenda opcional',
      },
    );
    expect(JSON.stringify(result)).not.toMatch(
      /mediaAsset|mediaUrl|bucket|objectKey|storageProvider|token/i,
    );
  });

  it.each([
    ['MEDIA_ASSET_NOT_FOUND', NotFoundException, 'Media asset was not found'],
    ['MEDIA_ASSET_NOT_READY', ConflictException, 'Media asset is not ready'],
    ['MEDIA_ASSET_EXPIRED', ConflictException, 'Media asset has expired'],
  ] as const)(
    'traduz %s para erro HTTP seguro',
    async (code, exceptionType, message) => {
      engineServiceMock.enqueueCampaign.mockRejectedValue(
        new MediaAssetEnqueueError(code, 'internal-storage-detail'),
      );

      try {
        await service.dispatchCampaign(
          automationId,
          {
            type: CampaignDispatchType.IMAGE,
            mediaAssetId: 'media-asset-1',
            audience: { type: CampaignAudienceType.ALL_ELIGIBLE },
          },
          companyId,
        );
        throw new Error('Expected dispatchCampaign to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(exceptionType);
        expect((error as Error).message).toBe(message);
        expect((error as Error).message).not.toContain(
          'internal-storage-detail',
        );
      }
    },
  );

  it('repassa erro seguro de campanha inexistente ou de outro tenant', async () => {
    const safeError = new NotFoundException('Campanha não encontrada');
    engineServiceMock.enqueueCampaign.mockRejectedValue(safeError);

    await expect(
      service.dispatchCampaign(automationId, textInput(), companyId),
    ).rejects.toBe(safeError);
  });

  it('mantém os mesmos argumentos em dispatch repetido para idempotência persistente', async () => {
    await service.dispatchCampaign(automationId, textInput(), companyId);
    await service.dispatchCampaign(automationId, textInput(), companyId);

    expect(engineServiceMock.enqueueCampaign).toHaveBeenCalledTimes(2);
    expect(engineServiceMock.enqueueCampaign.mock.calls[0]).toEqual(
      engineServiceMock.enqueueCampaign.mock.calls[1],
    );
  });

  it('delega preview tenant-aware sem disparar campanha', async () => {
    await expect(
      service.previewCampaignAudience(automationId, companyId),
    ).resolves.toEqual({
      audienceType: CampaignAudienceType.SEGMENTED,
      matched: 3,
      eligible: 2,
      blocked: 1,
    });
    expect(engineServiceMock.previewCampaignAudience).toHaveBeenCalledWith(
      companyId,
      automationId,
      { audienceType: undefined, customerIds: undefined },
    );
    expect(engineServiceMock.enqueueCampaign).not.toHaveBeenCalled();
  });

  it('normaliza e deduplica IDs no preview CUSTOMER_IDS', async () => {
    await service.previewCampaignAudience(automationId, companyId, {
      audience: {
        type: CampaignAudienceType.CUSTOMER_IDS,
        customerIds: [' customer-1 ', 'customer-2', 'customer-1'],
      },
    });

    expect(engineServiceMock.previewCampaignAudience).toHaveBeenCalledWith(
      companyId,
      automationId,
      {
        audienceType: CampaignAudienceType.CUSTOMER_IDS,
        customerIds: ['customer-1', 'customer-2'],
      },
    );
  });
});

describe('AutomationService campaign lifecycle', () => {
  const companyId = 'company-1';
  const prismaMock = {
    automation: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const engineServiceMock = { enqueueCampaign: jest.fn() };
  const service = new AutomationService(
    prismaMock as unknown as PrismaService,
    engineServiceMock as unknown as EngineService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.automation.count.mockResolvedValue(0);
    prismaMock.automation.create.mockImplementation(({ data }) => ({
      id: 'automation-1',
      ...data,
    }));
  });

  it('cria CAMPAIGN ativa com campos recorrentes nulos e tenant informado', async () => {
    const result = await service.createCampaign(
      { name: '  Promoção de Inverno  ' },
      companyId,
    );

    expect(prismaMock.automation.create).toHaveBeenCalledWith({
      data: {
        name: 'Promoção de Inverno',
        type: AutomationType.CAMPAIGN,
        daysAfter: null,
        message: null,
        isActive: true,
        cooldownHours: 24,
        isSystem: false,
        systemKey: null,
        companyId,
        campaignAudienceType: CampaignAudienceType.ALL_ELIGIBLE,
        segmentGender: null,
        segmentCity: null,
        segmentState: null,
        segmentMinAge: null,
        segmentMaxAge: null,
        segmentLastPurchaseBefore: null,
        segmentLastPurchaseAfter: null,
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        type: AutomationType.CAMPAIGN,
        daysAfter: null,
        message: null,
        isActive: true,
      }),
    );
    expect(prismaMock.automation.count).not.toHaveBeenCalled();
  });

  it('permite o mesmo nome de campanha em outro tenant', async () => {
    await service.createCampaign({ name: 'Promoção' }, 'company-1');
    await service.createCampaign({ name: 'Promoção' }, 'company-2');

    expect(
      prismaMock.automation.create.mock.calls.map(
        ([call]) => call.data.companyId,
      ),
    ).toEqual(['company-1', 'company-2']);
  });

  it('persiste SEGMENTED com filtros normalizados', async () => {
    await service.createCampaign(
      {
        name: 'Segmento PR',
        audienceType: CampaignAudienceType.SEGMENTED,
        segmentGender: CustomerGender.FEMALE,
        segmentCity: '  Curitiba  ',
        segmentState: 'pr',
        segmentMinAge: 18,
        segmentMaxAge: 35,
        segmentLastPurchaseAfter: '2026-01-01',
        segmentLastPurchaseBefore: '2026-07-01',
      },
      companyId,
    );

    expect(prismaMock.automation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        campaignAudienceType: CampaignAudienceType.SEGMENTED,
        segmentGender: CustomerGender.FEMALE,
        segmentCity: 'Curitiba',
        segmentState: 'PR',
        segmentMinAge: 18,
        segmentMaxAge: 35,
        segmentLastPurchaseAfter: new Date('2026-01-01'),
        segmentLastPurchaseBefore: new Date('2026-07-01'),
      }),
    });
  });

  it.each([
    [{ audienceType: CampaignAudienceType.SEGMENTED }],
    [
      {
        audienceType: CampaignAudienceType.ALL_ELIGIBLE,
        segmentState: 'PR',
      },
    ],
    [
      {
        audienceType: CampaignAudienceType.SEGMENTED,
        segmentState: 'ZZ',
      },
    ],
    [
      {
        audienceType: CampaignAudienceType.SEGMENTED,
        segmentMinAge: 36,
        segmentMaxAge: 35,
      },
    ],
    [
      {
        audienceType: CampaignAudienceType.SEGMENTED,
        segmentLastPurchaseAfter: '2026-07-02',
        segmentLastPurchaseBefore: '2026-07-01',
      },
    ],
  ])('rejeita configuração de audiência inválida %#', async (configuration) => {
    await expect(
      service.createCampaign(
        { name: 'Inválida', ...configuration } as never,
        companyId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.automation.create).not.toHaveBeenCalled();
  });

  it('converte conflito P2002 no mesmo tenant em 409 seguro', async () => {
    prismaMock.automation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('sensitive database detail', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.createCampaign({ name: 'Promoção' }, companyId),
    ).rejects.toThrow(
      new ConflictException('Já existe uma campanha com esse nome.'),
    );
  });

  it('não conta CAMPAIGN no limite de cinco automações recorrentes', async () => {
    await service.create(
      {
        name: 'Reativação customizada',
        type: AutomationType.REACTIVATION,
        daysAfter: 30,
        message: 'Olá',
      },
      companyId,
    );

    expect(prismaMock.automation.count).toHaveBeenCalledWith({
      where: {
        companyId,
        isSystem: false,
        type: {
          not: AutomationType.CAMPAIGN,
        },
      },
    });
  });

  it('preserva o limite de cinco para automações recorrentes', async () => {
    prismaMock.automation.count.mockResolvedValue(5);

    await expect(
      service.create(
        {
          name: 'Reativação customizada',
          type: AutomationType.REACTIVATION,
          daysAfter: 30,
          message: 'Olá',
        },
        companyId,
      ),
    ).rejects.toThrow(
      new ConflictException('Limite de 5 automações personalizadas atingido.'),
    );

    expect(prismaMock.automation.create).not.toHaveBeenCalled();
  });

  it('direciona CAMPAIGN para o endpoint específico', async () => {
    await expect(
      service.create(
        {
          name: 'Campanha antiga',
          type: AutomationType.CAMPAIGN,
          daysAfter: 1,
          message: 'artificial',
        },
        companyId,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Use o endpoint específico para criar campanhas.',
      ),
    );
  });

  it('permite renomear CAMPAIGN sem exigir daysAfter ou message', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
    });
    prismaMock.automation.update.mockResolvedValue({ id: 'campaign-1' });

    await service.update('campaign-1', { name: 'Novo nome' }, companyId);

    expect(prismaMock.automation.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { name: 'Novo nome' },
    });
  });

  it('limpa filtros ao mudar SEGMENTED para ALL_ELIGIBLE', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
      campaignAudienceType: CampaignAudienceType.SEGMENTED,
      segmentState: 'PR',
    });
    prismaMock.automation.update.mockResolvedValue({ id: 'campaign-1' });

    await service.update(
      'campaign-1',
      { audienceType: CampaignAudienceType.ALL_ELIGIBLE },
      companyId,
    );

    expect(prismaMock.automation.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: {
        campaignAudienceType: CampaignAudienceType.ALL_ELIGIBLE,
        segmentGender: null,
        segmentCity: null,
        segmentState: null,
        segmentMinAge: null,
        segmentMaxAge: null,
        segmentLastPurchaseBefore: null,
        segmentLastPurchaseAfter: null,
      },
    });
  });

  it('rejeita filtro segmentado junto de ALL_ELIGIBLE no update', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
      campaignAudienceType: CampaignAudienceType.SEGMENTED,
      segmentState: 'PR',
    });

    await expect(
      service.update(
        'campaign-1',
        {
          audienceType: CampaignAudienceType.ALL_ELIGIBLE,
          segmentCity: 'Curitiba',
        },
        companyId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.automation.update).not.toHaveBeenCalled();
  });

  it('não permite persistir CUSTOMER_IDS no update', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
      campaignAudienceType: CampaignAudienceType.ALL_ELIGIBLE,
    });

    await expect(
      service.update(
        'campaign-1',
        { audienceType: CampaignAudienceType.CUSTOMER_IDS },
        companyId,
      ),
    ).rejects.toThrow(
      'CUSTOMER_IDS audience is configured at preview or dispatch time',
    );
    expect(prismaMock.automation.update).not.toHaveBeenCalled();
  });
});
