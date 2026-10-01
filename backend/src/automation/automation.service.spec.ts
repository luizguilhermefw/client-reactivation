import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AutomationType,
  CustomerGender,
  CustomerInterestType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaAssetEnqueueError } from '../queue/media-asset-enqueue.error';
import { AutomationService } from './automation.service';
import {
  CampaignAudienceType,
  CampaignDispatchType,
  DispatchCampaignDto,
} from './dto/dispatch-campaign.dto';
import { EngineService } from './engine/engine.service';
import { MessagingChannelRoutingService } from '../messaging-channel/messaging-channel-routing.service';

describe('AutomationService campaign dispatch', () => {
  const engineServiceMock = {
    enqueueCampaign: jest.fn(),
    previewCampaignAudience: jest.fn(),
  };
  const service = new AutomationService(
    {} as PrismaService,
    engineServiceMock as unknown as EngineService,
    {} as MessagingChannelRoutingService,
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
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    customerInterestOption: { findMany: jest.fn() },
    campaignInterestFilter: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const engineServiceMock = { enqueueCampaign: jest.fn() };
  const messagingChannelRoutingServiceMock = {
    resolveForEnqueue: jest.fn(),
  };
  const service = new AutomationService(
    prismaMock as unknown as PrismaService,
    engineServiceMock as unknown as EngineService,
    messagingChannelRoutingServiceMock as unknown as MessagingChannelRoutingService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.automation.count.mockResolvedValue(0);
    prismaMock.automation.create.mockImplementation(({ data }) => ({
      id: 'automation-1',
      ...data,
    }));
    prismaMock.automation.findUniqueOrThrow.mockImplementation(() => ({
      ...prismaMock.automation.create.mock.results.at(-1)?.value,
      campaignInterestFilters: [],
    }));
    prismaMock.customerInterestOption.findMany.mockResolvedValue([]);
    prismaMock.campaignInterestFilter.createMany.mockResolvedValue({
      count: 0,
    });
    prismaMock.campaignInterestFilter.deleteMany.mockResolvedValue({
      count: 0,
    });
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(prismaMock),
    );
    messagingChannelRoutingServiceMock.resolveForEnqueue.mockImplementation(
      async (_companyId: string, messagingChannelId: string) => ({
        messagingChannelId: messagingChannelId.trim(),
      }),
    );
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

  it('retorna IDs segmentados sem vazar a relação interna', async () => {
    prismaMock.automation.findMany.mockResolvedValue([
      {
        id: 'campaign-1',
        type: AutomationType.CAMPAIGN,
        campaignInterestFilters: [
          {
            interestOptionId: 'category-1',
            interestOption: { type: CustomerInterestType.CATEGORY },
          },
          {
            interestOptionId: 'brand-1',
            interestOption: { type: CustomerInterestType.BRAND },
          },
        ],
      },
      {
        id: 'recurring-1',
        type: AutomationType.REACTIVATION,
        campaignInterestFilters: [],
      },
    ]);

    const result = await service.findAll(companyId);

    expect(result).toEqual([
      {
        id: 'campaign-1',
        type: AutomationType.CAMPAIGN,
        segmentCategoryIds: ['category-1'],
        segmentBrandIds: ['brand-1'],
      },
      { id: 'recurring-1', type: AutomationType.REACTIVATION },
    ]);
    expect(JSON.stringify(result)).not.toContain('campaignInterestFilters');
    expect(prismaMock.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId },
        include: expect.any(Object),
      }),
    );
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
    expect(
      messagingChannelRoutingServiceMock.resolveForEnqueue,
    ).not.toHaveBeenCalled();
    expect(
      prismaMock.automation.create.mock.calls[0][0].data,
    ).not.toHaveProperty('messagingChannelId');
  });

  it('persiste canal ACTIVE do mesmo tenant na automação recorrente', async () => {
    await service.create(
      {
        name: 'Reativação com canal',
        type: AutomationType.REACTIVATION,
        daysAfter: 30,
        message: 'Olá',
        messagingChannelId: 'channel-active-1',
      },
      companyId,
    );

    expect(
      messagingChannelRoutingServiceMock.resolveForEnqueue,
    ).toHaveBeenCalledWith(companyId, 'channel-active-1');
    expect(prismaMock.automation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        messagingChannelId: 'channel-active-1',
      }),
    });
  });

  it('persiste canal ACTIVE do mesmo tenant na Campaign', async () => {
    await service.createCampaign(
      {
        name: 'Campanha com canal',
        messagingChannelId: 'channel-campaign-1',
      },
      companyId,
    );

    expect(prismaMock.automation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messagingChannelId: 'channel-campaign-1',
      }),
    });
  });

  it.each(['cross-tenant', 'inactive'])(
    'rejeita canal explícito %s na criação',
    async () => {
      messagingChannelRoutingServiceMock.resolveForEnqueue.mockRejectedValue(
        new NotFoundException('Active messaging channel not found'),
      );

      await expect(
        service.create(
          {
            name: 'Reativação inválida',
            type: AutomationType.REACTIVATION,
            daysAfter: 30,
            message: 'Olá',
            messagingChannelId: 'invalid-channel',
          },
          companyId,
        ),
      ).rejects.toThrow('Active messaging channel not found');
      expect(prismaMock.automation.create).not.toHaveBeenCalled();
    },
  );

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
      include: expect.any(Object),
    });
  });

  it('altera o canal de uma automação para outro ACTIVE do mesmo tenant', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'automation-1',
      companyId,
      type: AutomationType.REACTIVATION,
      isSystem: false,
    });
    prismaMock.automation.update.mockResolvedValue({ id: 'automation-1' });

    await service.update(
      'automation-1',
      { messagingChannelId: 'channel-active-2' },
      companyId,
    );

    expect(prismaMock.automation.update).toHaveBeenCalledWith({
      where: { id: 'automation-1' },
      data: { messagingChannelId: 'channel-active-2' },
    });
  });

  it('permite limpar o canal persistido com null', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
    });
    prismaMock.automation.update.mockResolvedValue({ id: 'campaign-1' });

    await service.update('campaign-1', { messagingChannelId: null }, companyId);

    expect(prismaMock.automation.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { messagingChannelId: null },
      include: expect.any(Object),
    });
    expect(
      messagingChannelRoutingServiceMock.resolveForEnqueue,
    ).not.toHaveBeenCalled();
  });

  it.each(['cross-tenant', 'inactive'])(
    'rejeita canal explícito %s no update',
    async () => {
      prismaMock.automation.findFirst.mockResolvedValue({
        id: 'automation-1',
        companyId,
        type: AutomationType.REACTIVATION,
        isSystem: false,
      });
      messagingChannelRoutingServiceMock.resolveForEnqueue.mockRejectedValue(
        new NotFoundException('Active messaging channel not found'),
      );

      await expect(
        service.update(
          'automation-1',
          { messagingChannelId: 'invalid-channel' },
          companyId,
        ),
      ).rejects.toThrow('Active messaging channel not found');
      expect(prismaMock.automation.update).not.toHaveBeenCalled();
    },
  );

  it('limpa filtros ao mudar SEGMENTED para ALL_ELIGIBLE', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
      campaignAudienceType: CampaignAudienceType.SEGMENTED,
      segmentGender: CustomerGender.FEMALE,
      segmentCity: 'Curitiba',
      segmentState: 'PR',
      segmentMinAge: 18,
      segmentMaxAge: 60,
      segmentLastPurchaseBefore: new Date('2026-09-01'),
      segmentLastPurchaseAfter: new Date('2026-01-01'),
      campaignInterestFilters: [
        {
          interestOptionId: 'category-1',
          interestOption: { type: CustomerInterestType.CATEGORY },
        },
        {
          interestOptionId: 'brand-1',
          interestOption: { type: CustomerInterestType.BRAND },
        },
      ],
    });
    prismaMock.automation.update.mockResolvedValue({
      id: 'campaign-1',
      type: AutomationType.CAMPAIGN,
      campaignAudienceType: CampaignAudienceType.ALL_ELIGIBLE,
      segmentGender: null,
      segmentCity: null,
      segmentState: null,
      segmentMinAge: null,
      segmentMaxAge: null,
      segmentLastPurchaseBefore: null,
      segmentLastPurchaseAfter: null,
      campaignInterestFilters: [],
    });

    const result = await service.update(
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
      include: expect.any(Object),
    });
    expect(prismaMock.campaignInterestFilter.deleteMany).toHaveBeenCalledWith({
      where: { companyId, automationId: 'campaign-1' },
    });
    expect(result).toMatchObject({
      segmentGender: null,
      segmentCity: null,
      segmentState: null,
      segmentMinAge: null,
      segmentMaxAge: null,
      segmentLastPurchaseBefore: null,
      segmentLastPurchaseAfter: null,
      segmentCategoryIds: [],
      segmentBrandIds: [],
    });
    expect(JSON.stringify(result)).not.toContain('campaignInterestFilters');
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

  it('cria SEGMENTED com CATEGORY e BRAND validados no tenant em uma transação', async () => {
    prismaMock.customerInterestOption.findMany.mockResolvedValue([
      { id: 'category-1', type: CustomerInterestType.CATEGORY },
      { id: 'brand-1', type: CustomerInterestType.BRAND },
    ]);
    prismaMock.automation.findUniqueOrThrow.mockResolvedValue({
      id: 'automation-1',
      type: AutomationType.CAMPAIGN,
      campaignInterestFilters: [
        {
          interestOptionId: 'category-1',
          interestOption: { type: CustomerInterestType.CATEGORY },
        },
        {
          interestOptionId: 'brand-1',
          interestOption: { type: CustomerInterestType.BRAND },
        },
      ],
    });

    await expect(
      service.createCampaign(
        {
          name: 'Interesses PR',
          audienceType: CampaignAudienceType.SEGMENTED,
          segmentState: 'PR',
          segmentCategoryIds: ['category-1'],
          segmentBrandIds: ['brand-1'],
        },
        companyId,
      ),
    ).resolves.toMatchObject({
      segmentCategoryIds: ['category-1'],
      segmentBrandIds: ['brand-1'],
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.customerInterestOption.findMany).toHaveBeenCalledWith({
      where: {
        companyId,
        active: true,
        id: { in: ['category-1', 'brand-1'] },
      },
      select: { id: true, type: true },
    });
    expect(prismaMock.campaignInterestFilter.createMany).toHaveBeenCalledWith({
      data: [
        {
          companyId,
          automationId: 'automation-1',
          interestOptionId: 'category-1',
        },
        {
          companyId,
          automationId: 'automation-1',
          interestOptionId: 'brand-1',
        },
      ],
    });
  });

  it.each([
    [
      'CATEGORY',
      'segmentCategoryIds',
      'category-1',
      CustomerInterestType.CATEGORY,
    ],
    ['BRAND', 'segmentBrandIds', 'brand-1', CustomerInterestType.BRAND],
  ] as const)(
    'cria SEGMENTED somente com %s',
    async (_label, field, optionId, type) => {
      prismaMock.customerInterestOption.findMany.mockResolvedValue([
        { id: optionId, type },
      ]);

      await service.createCampaign(
        {
          name: `Somente ${type}`,
          audienceType: CampaignAudienceType.SEGMENTED,
          [field]: [optionId],
        },
        companyId,
      );

      expect(prismaMock.automation.create).toHaveBeenCalled();
      expect(prismaMock.campaignInterestFilter.createMany).toHaveBeenCalledWith(
        {
          data: [
            {
              companyId,
              automationId: 'automation-1',
              interestOptionId: optionId,
            },
          ],
        },
      );
    },
  );

  it.each([
    ['inexistente/inativa/cross-tenant', 'segmentCategoryIds', []],
    [
      'BRAND em CATEGORY',
      'segmentCategoryIds',
      [{ id: 'category-1', type: CustomerInterestType.BRAND }],
    ],
    [
      'CATEGORY em BRAND',
      'segmentBrandIds',
      [{ id: 'category-1', type: CustomerInterestType.CATEGORY }],
    ],
  ] as const)(
    'rejeita opção %s sem revelar detalhes',
    async (_scenario, field, options) => {
      prismaMock.customerInterestOption.findMany.mockResolvedValue(options);

      await expect(
        service.createCampaign(
          {
            name: 'Inválida',
            audienceType: CampaignAudienceType.SEGMENTED,
            [field]: ['category-1'],
          },
          companyId,
        ),
      ).rejects.toThrow(
        'Uma ou mais opções de interesse da campanha são inválidas.',
      );
      expect(prismaMock.automation.create).not.toHaveBeenCalled();
      expect(
        prismaMock.campaignInterestFilter.createMany,
      ).not.toHaveBeenCalled();
    },
  );

  it('rejeita limite combinado acima de 100 antes de persistir', async () => {
    await expect(
      service.createCampaign(
        {
          name: 'Grande demais',
          audienceType: CampaignAudienceType.SEGMENTED,
          segmentCategoryIds: Array.from(
            { length: 60 },
            (_, index) => `category-${index}`,
          ),
          segmentBrandIds: Array.from(
            { length: 41 },
            (_, index) => `brand-${index}`,
          ),
        },
        companyId,
      ),
    ).rejects.toThrow('Campaign interest filter limit exceeded');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('substitui CATEGORY e preserva BRAND omitida no update atômico', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
      campaignAudienceType: CampaignAudienceType.SEGMENTED,
      campaignInterestFilters: [
        {
          interestOptionId: 'old-category',
          interestOption: { type: CustomerInterestType.CATEGORY },
        },
        {
          interestOptionId: 'existing-brand',
          interestOption: { type: CustomerInterestType.BRAND },
        },
      ],
    });
    prismaMock.customerInterestOption.findMany.mockResolvedValue([
      { id: 'new-category', type: CustomerInterestType.CATEGORY },
    ]);
    prismaMock.automation.update.mockResolvedValue({
      id: 'campaign-1',
      type: AutomationType.CAMPAIGN,
      campaignInterestFilters: [
        {
          interestOptionId: 'new-category',
          interestOption: { type: CustomerInterestType.CATEGORY },
        },
        {
          interestOptionId: 'existing-brand',
          interestOption: { type: CustomerInterestType.BRAND },
        },
      ],
    });

    await expect(
      service.update(
        'campaign-1',
        { segmentCategoryIds: ['new-category'] },
        companyId,
      ),
    ).resolves.toMatchObject({
      segmentCategoryIds: ['new-category'],
      segmentBrandIds: ['existing-brand'],
    });

    expect(prismaMock.campaignInterestFilter.deleteMany).toHaveBeenCalledWith({
      where: {
        companyId,
        automationId: 'campaign-1',
        interestOption: { is: { type: CustomerInterestType.CATEGORY } },
      },
    });
    expect(prismaMock.campaignInterestFilter.createMany).toHaveBeenCalledWith({
      data: [
        {
          companyId,
          automationId: 'campaign-1',
          interestOptionId: 'new-category',
        },
      ],
    });
  });

  it('adiciona CATEGORY quando a campanha ainda não possui CATEGORY', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
      campaignAudienceType: CampaignAudienceType.SEGMENTED,
      segmentState: 'PR',
      campaignInterestFilters: [],
    });
    prismaMock.customerInterestOption.findMany.mockResolvedValue([
      { id: 'category-1', type: CustomerInterestType.CATEGORY },
    ]);
    prismaMock.automation.update.mockResolvedValue({
      id: 'campaign-1',
      type: AutomationType.CAMPAIGN,
      campaignInterestFilters: [
        {
          interestOptionId: 'category-1',
          interestOption: { type: CustomerInterestType.CATEGORY },
        },
      ],
    });

    await expect(
      service.update(
        'campaign-1',
        { segmentCategoryIds: ['category-1'] },
        companyId,
      ),
    ).resolves.toMatchObject({ segmentCategoryIds: ['category-1'] });

    expect(prismaMock.campaignInterestFilter.createMany).toHaveBeenCalledWith({
      data: [
        {
          companyId,
          automationId: 'campaign-1',
          interestOptionId: 'category-1',
        },
      ],
    });
  });

  it('substitui BRAND e preserva CATEGORY omitida', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
      campaignAudienceType: CampaignAudienceType.SEGMENTED,
      campaignInterestFilters: [
        {
          interestOptionId: 'existing-category',
          interestOption: { type: CustomerInterestType.CATEGORY },
        },
        {
          interestOptionId: 'old-brand',
          interestOption: { type: CustomerInterestType.BRAND },
        },
      ],
    });
    prismaMock.customerInterestOption.findMany.mockResolvedValue([
      { id: 'new-brand', type: CustomerInterestType.BRAND },
    ]);
    prismaMock.automation.update.mockResolvedValue({
      id: 'campaign-1',
      type: AutomationType.CAMPAIGN,
      campaignInterestFilters: [
        {
          interestOptionId: 'existing-category',
          interestOption: { type: CustomerInterestType.CATEGORY },
        },
        {
          interestOptionId: 'new-brand',
          interestOption: { type: CustomerInterestType.BRAND },
        },
      ],
    });

    await expect(
      service.update(
        'campaign-1',
        { segmentBrandIds: ['new-brand'] },
        companyId,
      ),
    ).resolves.toMatchObject({
      segmentCategoryIds: ['existing-category'],
      segmentBrandIds: ['new-brand'],
    });

    expect(prismaMock.campaignInterestFilter.deleteMany).toHaveBeenCalledWith({
      where: {
        companyId,
        automationId: 'campaign-1',
        interestOption: { is: { type: CustomerInterestType.BRAND } },
      },
    });
  });

  it('aplica limite combinado no update incluindo CATEGORY preservada', async () => {
    const existingCategories = Array.from({ length: 90 }, (_, index) => ({
      interestOptionId: `category-${index}`,
      interestOption: { type: CustomerInterestType.CATEGORY },
    }));
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
      campaignAudienceType: CampaignAudienceType.SEGMENTED,
      campaignInterestFilters: existingCategories,
    });

    await expect(
      service.update(
        'campaign-1',
        {
          segmentBrandIds: Array.from(
            { length: 20 },
            (_, index) => `brand-${index}`,
          ),
        },
        companyId,
      ),
    ).rejects.toThrow('Campaign interest filter limit exceeded');

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.customerInterestOption.findMany).not.toHaveBeenCalled();
    expect(prismaMock.campaignInterestFilter.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.campaignInterestFilter.createMany).not.toHaveBeenCalled();
    expect(prismaMock.automation.update).not.toHaveBeenCalled();
  });

  it.each([
    ['CATEGORY', 'segmentCategoryIds', CustomerInterestType.CATEGORY],
    ['BRAND', 'segmentBrandIds', CustomerInterestType.BRAND],
  ] as const)('limpa %s com lista vazia', async (_label, field, type) => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
      campaignAudienceType: CampaignAudienceType.SEGMENTED,
      segmentState: 'PR',
      campaignInterestFilters: [
        {
          interestOptionId: 'old-option',
          interestOption: { type },
        },
      ],
    });
    prismaMock.automation.update.mockResolvedValue({
      id: 'campaign-1',
      type: AutomationType.CAMPAIGN,
      campaignInterestFilters: [],
    });

    await service.update('campaign-1', { [field]: [] }, companyId);

    expect(prismaMock.campaignInterestFilter.deleteMany).toHaveBeenCalledWith({
      where: {
        companyId,
        automationId: 'campaign-1',
        interestOption: { is: { type } },
      },
    });
    expect(prismaMock.campaignInterestFilter.createMany).not.toHaveBeenCalled();
  });

  it('opção inválida no update não altera campos nem relações', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
      campaignAudienceType: CampaignAudienceType.SEGMENTED,
      segmentState: 'PR',
      campaignInterestFilters: [],
    });
    prismaMock.customerInterestOption.findMany.mockResolvedValue([]);

    await expect(
      service.update(
        'campaign-1',
        { segmentBrandIds: ['cross-tenant-brand'] },
        companyId,
      ),
    ).rejects.toThrow(
      'Uma ou mais opções de interesse da campanha são inválidas.',
    );
    expect(prismaMock.campaignInterestFilter.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.automation.update).not.toHaveBeenCalled();
  });

  it('falha de persistência da relação impede update da campanha', async () => {
    prismaMock.automation.findFirst.mockResolvedValue({
      id: 'campaign-1',
      companyId,
      type: AutomationType.CAMPAIGN,
      isSystem: false,
      campaignAudienceType: CampaignAudienceType.SEGMENTED,
      segmentState: 'PR',
      campaignInterestFilters: [],
    });
    prismaMock.customerInterestOption.findMany.mockResolvedValue([
      { id: 'category-1', type: CustomerInterestType.CATEGORY },
    ]);
    prismaMock.campaignInterestFilter.createMany.mockRejectedValue(
      new Error('relation persistence failed'),
    );

    await expect(
      service.update(
        'campaign-1',
        { segmentCategoryIds: ['category-1'] },
        companyId,
      ),
    ).rejects.toThrow('relation persistence failed');
    expect(prismaMock.automation.update).not.toHaveBeenCalled();
  });

  it('não converte P2002 da relação em conflito de nome da campanha', async () => {
    prismaMock.customerInterestOption.findMany.mockResolvedValue([
      { id: 'category-1', type: CustomerInterestType.CATEGORY },
    ]);
    const relationConflict = new Prisma.PrismaClientKnownRequestError(
      'relation conflict',
      {
        code: 'P2002',
        clientVersion: 'test',
        meta: {
          target: ['companyId', 'automationId', 'interestOptionId'],
        },
      },
    );
    prismaMock.campaignInterestFilter.createMany.mockRejectedValue(
      relationConflict,
    );

    await expect(
      service.createCampaign(
        {
          name: 'Concorrente',
          audienceType: CampaignAudienceType.SEGMENTED,
          segmentCategoryIds: ['category-1'],
        },
        companyId,
      ),
    ).rejects.toBe(relationConflict);
  });
});
