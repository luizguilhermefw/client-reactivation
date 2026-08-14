import { NotFoundException } from '@nestjs/common';
import {
  CampaignAudienceType,
  CustomerContactConsentStatus,
  CustomerGender,
  LogStatus,
  OutboundMessageSource,
  OutboundMessageStatus,
  OutboundMessageType,
  UnknownContactPolicy,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AutomationEligibilityCustomer,
  CustomerEligibilityService,
} from '../../customer/customer-eligibility.service';
import { QueueService } from '../../queue/queue.service';
import { EngineService } from './engine.service';
import { CAMPAIGN_OPT_OUT_FOOTER } from '../campaign/campaign-message';

describe('EngineService', () => {
  let service: EngineService;
  const originalAppTimezone = process.env.APP_TIMEZONE;

  const prismaMock = {
    company: {
      findUnique: jest.fn(),
    },
    automation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    customer: {
      findMany: jest.fn(),
    },
    messageLog: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    outboundMessage: {
      findFirst: jest.fn(),
    },
  };

  const queueServiceMock = {
    enqueue: jest.fn(),
  };

  const customerEligibilityServiceMock = {
    isEligibleForAutomation: jest.fn(
      (
        eligibleCustomer: AutomationEligibilityCustomer,
        policy: UnknownContactPolicy,
      ) => {
        if (!eligibleCustomer.isActiveForAutomation) return false;
        if (
          eligibleCustomer.contactConsentStatus ===
          CustomerContactConsentStatus.OPTED_OUT
        ) {
          return false;
        }
        return (
          eligibleCustomer.contactConsentStatus ===
            CustomerContactConsentStatus.GRANTED ||
          policy === UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION
        );
      },
    ),
  };

  const now = new Date('2026-07-30T15:00:00.000Z');
  const companyId = 'company-1';

  const customer = {
    id: 'customer-1',
    companyId,
    name: 'Luiz',
    phone: '5545999999999',
    lastPurchaseDate: new Date('2026-06-01T15:00:00.000Z'),
    birthDate: new Date('1990-07-30T12:00:00.000Z'),
    isActiveForAutomation: true,
    contactConsentStatus: CustomerContactConsentStatus.UNKNOWN,
  };

  const automation = {
    id: 'automation-1',
    companyId,
    name: 'Reativação',
    type: 'REACTIVATION',
    daysAfter: 30,
    message: 'Olá, {{ nome }}!',
    isActive: true,
    cooldownHours: 24,
  };

  beforeEach(() => {
    delete process.env.APP_TIMEZONE;
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();

    service = new EngineService(
      prismaMock as unknown as PrismaService,
      queueServiceMock as unknown as QueueService,
      customerEligibilityServiceMock as unknown as CustomerEligibilityService,
    );

    prismaMock.customer.findMany.mockResolvedValue([customer]);
    prismaMock.company.findUnique.mockResolvedValue({
      unknownContactPolicy: UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
    });
    prismaMock.messageLog.findFirst.mockResolvedValue(null);
    prismaMock.outboundMessage.findFirst.mockResolvedValue(null);
    prismaMock.automation.findMany.mockResolvedValue([]);
    prismaMock.automation.findFirst.mockResolvedValue(null);
    queueServiceMock.enqueue.mockResolvedValue({
      id: 'outbound-message-1',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => {
    if (originalAppTimezone === undefined) {
      delete process.env.APP_TIMEZONE;
      return;
    }

    process.env.APP_TIMEZONE = originalAppTimezone;
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  it('enfileira mensagem elegível personalizada com tenant, IDs e source corretos', async () => {
    await service.sendMessage(customer, automation);

    expect(queueServiceMock.enqueue).toHaveBeenCalledWith({
      companyId,
      customerId: customer.id,
      automationId: automation.id,
      source: OutboundMessageSource.AUTOMATION,
      recipientPhone: customer.phone,
      content: 'Olá, Luiz!',
      idempotencyKey:
        'automation:automation-1:customer:customer-1:cycle:2026-07-30',
    });
  });

  it('sendMessage ignora OPTED_OUT sem consultar fila ou enfileirar', async () => {
    await service.sendMessage(
      {
        ...customer,
        contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
      },
      automation,
    );

    expect(prismaMock.outboundMessage.findFirst).not.toHaveBeenCalled();
    expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
  });

  it('gera idempotencyKey determinística de aniversário na data configurada', async () => {
    await service.sendMessage(customer, {
      ...automation,
      type: 'BIRTHDAY',
    });

    expect(queueServiceMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          'automation:automation-1:customer:customer-1:birthday:2026-07-30',
      }),
    );
  });

  it('mantém 2026-07-30 às 23:30 em São Paulo mesmo quando UTC já é 31/07', async () => {
    process.env.APP_TIMEZONE = 'America/Sao_Paulo';
    jest.setSystemTime(new Date('2026-07-31T02:30:00.000Z'));

    await service.handleBirthday({
      ...automation,
      type: 'BIRTHDAY',
    });

    expect(queueServiceMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          'automation:automation-1:customer:customer-1:birthday:2026-07-30',
      }),
    );
  });

  it('preserva o dia civil de birthDate armazenado à meia-noite UTC', async () => {
    process.env.APP_TIMEZONE = 'America/Sao_Paulo';
    jest.setSystemTime(new Date('2026-07-30T15:00:00.000Z'));
    prismaMock.customer.findMany.mockResolvedValue([
      {
        ...customer,
        birthDate: new Date('1990-07-30T00:00:00.000Z'),
      },
    ]);

    await service.handleBirthday({
      ...automation,
      type: 'BIRTHDAY',
    });

    expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(1);
  });

  it('não antecipa para 29/07 aniversário civil armazenado como 30/07 UTC', async () => {
    process.env.APP_TIMEZONE = 'America/Sao_Paulo';
    jest.setSystemTime(new Date('2026-07-30T02:30:00.000Z'));
    prismaMock.customer.findMany.mockResolvedValue([
      {
        ...customer,
        birthDate: new Date('1990-07-30T00:00:00.000Z'),
      },
    ]);

    await service.handleBirthday({
      ...automation,
      type: 'BIRTHDAY',
    });

    expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
  });

  it('não usa MessageService nem cria MessageLog ao enfileirar', async () => {
    await service.sendMessage(customer, automation);

    expect(
      (service as unknown as Record<string, unknown>).messageService,
    ).toBeUndefined();
    expect(prismaMock.messageLog.create).not.toHaveBeenCalled();
  });

  it.each([OutboundMessageStatus.PENDING, OutboundMessageStatus.PROCESSING])(
    'não enfileira quando existe OutboundMessage %s',
    async (status) => {
      prismaMock.outboundMessage.findFirst.mockResolvedValue({
        id: 'active-message-1',
        status,
      });

      await service.sendMessage(customer, automation);

      expect(prismaMock.outboundMessage.findFirst).toHaveBeenCalledWith({
        where: {
          companyId,
          customerId: customer.id,
          automationId: automation.id,
          status: {
            in: [
              OutboundMessageStatus.PENDING,
              OutboundMessageStatus.PROCESSING,
            ],
          },
        },
        select: {
          id: true,
        },
      });
      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
    },
  );

  it('permite enfileirar quando não existe mensagem ativa', async () => {
    prismaMock.outboundMessage.findFirst.mockResolvedValue(null);

    await service.sendMessage(customer, automation);

    expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(1);
  });

  it('mantém bloqueio por MessageLog SENT dentro do cooldown e filtra companyId', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    prismaMock.messageLog.findFirst.mockResolvedValue({
      id: 'message-log-1',
      status: LogStatus.SENT,
    });

    const result = await service.canSendMessage(customer.id, automation);

    expect(result).toBe(false);
    expect(prismaMock.messageLog.findFirst).toHaveBeenCalledWith({
      where: {
        companyId,
        customerId: customer.id,
        automationId: automation.id,
        status: LogStatus.SENT,
        sentAt: {
          gte: new Date('2026-07-29T15:00:00.000Z'),
        },
      },
    });
    expect(prismaMock.outboundMessage.findFirst).not.toHaveBeenCalled();
  });

  it('rejeita customer e automation de tenants diferentes', async () => {
    await expect(
      service.sendMessage(customer, {
        ...automation,
        companyId: 'company-2',
      }),
    ).rejects.toThrow('Cliente e automação pertencem a empresas diferentes');

    expect(prismaMock.outboundMessage.findFirst).not.toHaveBeenCalled();
    expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
  });

  it('mantém automação de reativação enfileirando cliente UNKNOWN ativo', async () => {
    await service.handleReactivation(automation);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
      where: {
        companyId,
        isActiveForAutomation: true,
      },
    });
    expect(queueServiceMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: customer.id,
        automationId: automation.id,
        idempotencyKey:
          'automation:automation-1:customer:customer-1:cycle:2026-07-30',
      }),
    );
  });

  it('mantém automação de reativação enfileirando cliente GRANTED ativo', async () => {
    prismaMock.customer.findMany.mockResolvedValue([
      {
        ...customer,
        contactConsentStatus: CustomerContactConsentStatus.GRANTED,
      },
    ]);

    await service.handleReactivation(automation);

    expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(1);
  });

  it('não enfileira reativação para cliente OPTED_OUT ativo', async () => {
    prismaMock.customer.findMany.mockResolvedValue([
      {
        ...customer,
        contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
      },
    ]);

    await service.handleReactivation(automation);

    expect(prismaMock.messageLog.findFirst).not.toHaveBeenCalled();
    expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
  });

  it('não enfileira reativação para cliente inativo', async () => {
    prismaMock.customer.findMany.mockResolvedValue([
      {
        ...customer,
        isActiveForAutomation: false,
      },
    ]);

    await service.handleReactivation(automation);

    expect(prismaMock.messageLog.findFirst).not.toHaveBeenCalled();
    expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
  });

  it('mantém automação de aniversário enfileirando clientes aniversariantes', async () => {
    const birthdayAutomation = {
      ...automation,
      type: 'BIRTHDAY',
    };

    await service.handleBirthday(birthdayAutomation);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
      where: {
        companyId,
        birthDate: {
          not: null,
        },
        isActiveForAutomation: true,
      },
    });
    expect(queueServiceMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          'automation:automation-1:customer:customer-1:birthday:2026-07-30',
      }),
    );
  });

  it('não enfileira aniversário para cliente OPTED_OUT', async () => {
    prismaMock.customer.findMany.mockResolvedValue([
      {
        ...customer,
        contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
      },
    ]);

    await service.handleBirthday({
      ...automation,
      type: 'BIRTHDAY',
    });

    expect(prismaMock.messageLog.findFirst).not.toHaveBeenCalled();
    expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
  });

  it('mantém automação de manutenção usando o ciclo de reativação', async () => {
    const maintenanceAutomation = {
      ...automation,
      type: 'MAINTENANCE',
    };

    await service.handleMaintenance(maintenanceAutomation);

    expect(queueServiceMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          'automation:automation-1:customer:customer-1:cycle:2026-07-30',
      }),
    );
  });

  it.each([
    ['REACTIVATION', null, 'Mensagem'],
    ['REACTIVATION', 30, null],
    ['MAINTENANCE', null, 'Mensagem'],
    ['MAINTENANCE', 30, null],
    ['BIRTHDAY', 1, null],
  ])(
    'falha de forma explícita quando %s não possui configuração obrigatória',
    async (type, daysAfter, message) => {
      const invalidAutomation = {
        ...automation,
        type,
        daysAfter,
        message,
      };

      const operation =
        type === 'BIRTHDAY'
          ? service.handleBirthday(invalidAutomation)
          : type === 'MAINTENANCE'
            ? service.handleMaintenance(invalidAutomation)
            : service.handleReactivation(invalidAutomation);

      await expect(operation).rejects.toThrow(
        'Automation configuration is invalid',
      );
      expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
    },
  );

  describe('campanha', () => {
    const campaign = {
      ...automation,
      id: 'campaign-automation-1',
      name: 'Campanha promocional',
      type: 'CAMPAIGN',
      message: null,
      campaignAudienceType: CampaignAudienceType.ALL_ELIGIBLE,
      segmentGender: null,
      segmentCity: null,
      segmentState: null,
      segmentMinAge: null,
      segmentMaxAge: null,
      segmentLastPurchaseBefore: null,
      segmentLastPurchaseAfter: null,
    };

    beforeEach(() => {
      prismaMock.automation.findFirst.mockResolvedValue(campaign);
      prismaMock.customer.findMany.mockResolvedValue([customer]);
      prismaMock.outboundMessage.findFirst.mockResolvedValue(null);
    });

    it('preserva campanha TEXT quando mediaAssetId não é informado', async () => {
      await service.enqueueCampaign(companyId, campaign.id, {
        content: 'Oferta para {{ nome }}',
      });

      expect(queueServiceMock.enqueue).toHaveBeenCalledWith({
        companyId,
        customerId: customer.id,
        automationId: campaign.id,
        source: OutboundMessageSource.CAMPAIGN,
        type: OutboundMessageType.TEXT,
        recipientPhone: customer.phone,
        content: `Oferta para Luiz\n\n${CAMPAIGN_OPT_OUT_FOOTER}`,
        idempotencyKey: 'campaign:campaign-automation-1:customer:customer-1',
      });
    });

    it('usa o conteúdo TEXT do dispatch e retorna contadores seguros', async () => {
      const result = await service.enqueueCampaign(companyId, campaign.id, {
        content: 'Mensagem da API para {{ nome }}',
      });

      expect(queueServiceMock.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: OutboundMessageType.TEXT,
          content: `Mensagem da API para Luiz\n\n${CAMPAIGN_OPT_OUT_FOOTER}`,
        }),
      );
      expect(result).toEqual({
        eligibleCustomers: 1,
        processed: 1,
      });
    });

    it('ALL_ELIGIBLE processa UNKNOWN e GRANTED e ignora OPTED_OUT nos contadores', async () => {
      prismaMock.customer.findMany.mockResolvedValue([
        customer,
        {
          ...customer,
          id: 'customer-granted',
          contactConsentStatus: CustomerContactConsentStatus.GRANTED,
        },
        {
          ...customer,
          id: 'customer-opted-out',
          contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
        },
      ]);

      const result = await service.enqueueCampaign(companyId, campaign.id, {
        content: 'Oferta',
      });

      expect(result).toEqual({
        eligibleCustomers: 2,
        processed: 2,
      });
      expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(2);
      expect(
        queueServiceMock.enqueue.mock.calls.map(([input]) => input.customerId),
      ).toEqual(['customer-1', 'customer-granted']);
    });

    it('customerIds processa UNKNOWN e omite OPTED_OUT sem criar queue entry', async () => {
      const optedOutCustomer = {
        ...customer,
        id: 'customer-opted-out',
        contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
      };
      prismaMock.customer.findMany.mockResolvedValue([
        customer,
        optedOutCustomer,
      ]);

      const result = await service.enqueueCampaign(companyId, campaign.id, {
        customerIds: [customer.id, optedOutCustomer.id],
        content: 'Oferta',
      });

      expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
        where: {
          companyId,
          isActiveForAutomation: true,
          id: {
            in: [customer.id, optedOutCustomer.id],
          },
        },
      });
      expect(result).toEqual({
        eligibleCustomers: 1,
        processed: 1,
      });
      expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(1);
      expect(queueServiceMock.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: customer.id }),
      );
    });

    it('rejeita dispatch TEXT sem content sem usar automation.message', async () => {
      await expect(
        service.enqueueCampaign(companyId, campaign.id),
      ).rejects.toThrow('Campaign text content is required');

      expect(prismaMock.automation.findFirst).not.toHaveBeenCalled();
      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
    });

    it('gera campanha IMAGE vinculada ao MediaAsset sem URL', async () => {
      await service.enqueueCampaign(companyId, campaign.id, {
        mediaAssetId: 'media-asset-1',
        caption: 'Oferta exclusiva para {{ nome }}',
      });

      const input = queueServiceMock.enqueue.mock.calls[0][0];
      expect(input).toEqual({
        companyId,
        customerId: customer.id,
        automationId: campaign.id,
        source: OutboundMessageSource.CAMPAIGN,
        type: OutboundMessageType.IMAGE,
        mediaAssetId: 'media-asset-1',
        recipientPhone: customer.phone,
        payload: {
          caption: `Oferta exclusiva para Luiz\n\n${CAMPAIGN_OPT_OUT_FOOTER}`,
        },
        idempotencyKey: 'campaign:campaign-automation-1:customer:customer-1',
      });
      expect(input.payload).not.toHaveProperty('mediaUrl');
      expect(input.payload).not.toHaveProperty('bucket');
      expect(input.payload).not.toHaveProperty('objectKey');
    });

    it('adiciona o footer como caption quando IMAGE não possui legenda', async () => {
      await service.enqueueCampaign(companyId, campaign.id, {
        mediaAssetId: 'media-asset-1',
      });

      expect(queueServiceMock.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { caption: CAMPAIGN_OPT_OUT_FOOTER },
        }),
      );
    });

    it('não duplica o footer no payload final', async () => {
      await service.enqueueCampaign(companyId, campaign.id, {
        content: `Oferta\n\n${CAMPAIGN_OPT_OUT_FOOTER}`,
      });

      const finalContent = queueServiceMock.enqueue.mock.calls[0][0].content;
      expect(finalContent).toBe(`Oferta\n\n${CAMPAIGN_OPT_OUT_FOOTER}`);
      expect(finalContent.match(/responda PARAR\./g)).toHaveLength(1);
    });

    it('SEGMENTED aplica filtros combinados em query tenant-aware e enfileira somente elegíveis', async () => {
      prismaMock.automation.findFirst.mockResolvedValue({
        ...campaign,
        campaignAudienceType: CampaignAudienceType.SEGMENTED,
        segmentGender: CustomerGender.FEMALE,
        segmentCity: 'Curitiba',
        segmentState: 'PR',
        segmentMinAge: 18,
        segmentMaxAge: 35,
        segmentLastPurchaseAfter: new Date('2026-01-01T00:00:00.000Z'),
        segmentLastPurchaseBefore: new Date('2026-07-01T00:00:00.000Z'),
      });
      prismaMock.customer.findMany.mockResolvedValue([
        customer,
        {
          ...customer,
          id: 'opted-out',
          contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
        },
        { ...customer, id: 'inactive', isActiveForAutomation: false },
      ]);

      const result = await service.enqueueCampaign(companyId, campaign.id, {
        audienceType: CampaignAudienceType.SEGMENTED,
        content: 'Oferta',
      });

      expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          companyId,
          gender: CustomerGender.FEMALE,
          city: { equals: 'Curitiba', mode: 'insensitive' },
          state: 'PR',
          birthDate: expect.any(Object),
          lastPurchaseDate: {
            gt: new Date('2026-01-01T00:00:00.000Z'),
            lt: new Date('2026-07-01T00:00:00.000Z'),
          },
        }),
      });
      expect(result).toEqual({ eligibleCustomers: 1, processed: 1 });
      expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(1);
    });

    it.each([
      [CampaignAudienceType.ALL_ELIGIBLE, undefined],
      [CampaignAudienceType.CUSTOMER_IDS, ['customer-1']],
    ])(
      'campaign SEGMENTED persistida rejeita override para %s',
      async (audienceType, customerIds) => {
        prismaMock.automation.findFirst.mockResolvedValue({
          ...campaign,
          campaignAudienceType: CampaignAudienceType.SEGMENTED,
          segmentState: 'PR',
        });

        await expect(
          service.enqueueCampaign(companyId, campaign.id, {
            audienceType,
            customerIds,
            content: 'Oferta',
          }),
        ).rejects.toThrow('Segmented campaign audience cannot be overridden');
        expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
        expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
      },
    );

    it('campaign SEGMENTED persistida permite dispatch SEGMENTED', async () => {
      prismaMock.automation.findFirst.mockResolvedValue({
        ...campaign,
        campaignAudienceType: CampaignAudienceType.SEGMENTED,
        segmentState: 'PR',
      });

      await expect(
        service.enqueueCampaign(companyId, campaign.id, {
          audienceType: CampaignAudienceType.SEGMENTED,
          content: 'Oferta',
        }),
      ).resolves.toEqual({ eligibleCustomers: 1, processed: 1 });
      expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
        where: { companyId, state: 'PR' },
      });
    });

    it('preview SEGMENTED retorna somente contagens e não cria mensagem ou altera campanha', async () => {
      prismaMock.automation.findFirst.mockResolvedValue({
        ...campaign,
        campaignAudienceType: CampaignAudienceType.SEGMENTED,
        segmentState: 'PR',
      });
      prismaMock.customer.findMany.mockResolvedValue([
        {
          isActiveForAutomation: true,
          contactConsentStatus: CustomerContactConsentStatus.UNKNOWN,
        },
        {
          isActiveForAutomation: true,
          contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
        },
        {
          isActiveForAutomation: false,
          contactConsentStatus: CustomerContactConsentStatus.GRANTED,
        },
      ]);

      await expect(
        service.previewCampaignAudience(companyId, campaign.id),
      ).resolves.toEqual({
        audienceType: CampaignAudienceType.SEGMENTED,
        matched: 3,
        eligible: 1,
        blocked: 2,
      });
      expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
        where: { companyId, state: 'PR' },
        select: {
          isActiveForAutomation: true,
          contactConsentStatus: true,
        },
      });
      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
      expect(prismaMock.automation.update).toBeUndefined();
    });

    it.each([
      [CampaignAudienceType.ALL_ELIGIBLE, undefined],
      [CampaignAudienceType.CUSTOMER_IDS, ['customer-1']],
    ])(
      'preview SEGMENTED persistido rejeita override para %s',
      async (audienceType, customerIds) => {
        prismaMock.automation.findFirst.mockResolvedValue({
          ...campaign,
          campaignAudienceType: CampaignAudienceType.SEGMENTED,
          segmentState: 'PR',
        });

        await expect(
          service.previewCampaignAudience(companyId, campaign.id, {
            audienceType,
            customerIds,
          }),
        ).rejects.toThrow('Segmented campaign audience cannot be overridden');
        expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
      },
    );

    it('preview CUSTOMER_IDS deduplica em service, consulta somente o tenant e conta inativos como bloqueados', async () => {
      prismaMock.customer.findMany.mockResolvedValue([
        {
          isActiveForAutomation: true,
          contactConsentStatus: CustomerContactConsentStatus.GRANTED,
        },
        {
          isActiveForAutomation: false,
          contactConsentStatus: CustomerContactConsentStatus.GRANTED,
        },
      ]);

      await expect(
        service.previewCampaignAudience(companyId, campaign.id, {
          audienceType: CampaignAudienceType.CUSTOMER_IDS,
          customerIds: ['customer-1', 'customer-2'],
        }),
      ).resolves.toEqual({
        audienceType: CampaignAudienceType.CUSTOMER_IDS,
        matched: 2,
        eligible: 1,
        blocked: 1,
      });
      expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
        where: {
          companyId,
          id: { in: ['customer-1', 'customer-2'] },
        },
        select: {
          isActiveForAutomation: true,
          contactConsentStatus: true,
        },
      });
      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
    });

    it.each([undefined, CampaignAudienceType.ALL_ELIGIBLE])(
      'preview de campaign default usa ALL_ELIGIBLE com override %s',
      async (audienceType) => {
        prismaMock.customer.findMany.mockResolvedValue([
          {
            isActiveForAutomation: true,
            contactConsentStatus: CustomerContactConsentStatus.GRANTED,
          },
          {
            isActiveForAutomation: true,
            contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
          },
          {
            isActiveForAutomation: false,
            contactConsentStatus: CustomerContactConsentStatus.GRANTED,
          },
        ]);

        await expect(
          service.previewCampaignAudience(companyId, campaign.id, {
            audienceType,
          }),
        ).resolves.toEqual({
          audienceType: CampaignAudienceType.ALL_ELIGIBLE,
          matched: 3,
          eligible: 1,
          blocked: 2,
        });
        expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
          where: { companyId },
          select: {
            isActiveForAutomation: true,
            contactConsentStatus: true,
          },
        });
        expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
        expect(prismaMock.automation.update).toBeUndefined();
      },
    );

    it('rejeita SEGMENTED sem configuração persistida', async () => {
      await expect(
        service.enqueueCampaign(companyId, campaign.id, {
          audienceType: CampaignAudienceType.SEGMENTED,
          content: 'Oferta',
        }),
      ).rejects.toThrow('Segmented campaign filters are not configured');

      expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
    });

    it('rejeita customerIds junto de SEGMENTED em chamada interna direta', async () => {
      prismaMock.automation.findFirst.mockResolvedValue({
        ...campaign,
        campaignAudienceType: CampaignAudienceType.SEGMENTED,
        segmentState: 'PR',
      });

      await expect(
        service.enqueueCampaign(companyId, campaign.id, {
          audienceType: CampaignAudienceType.SEGMENTED,
          customerIds: ['customer-1'],
          content: 'Oferta',
        }),
      ).rejects.toThrow(
        'Campaign audience does not match the supplied customer IDs',
      );
      expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
    });

    it('filtra público por tenant e elegibilidade existente', async () => {
      await service.enqueueCampaign(companyId, campaign.id, {
        customerIds: ['customer-1', 'customer-2', 'customer-1'],
        content: 'Oferta',
      });

      expect(prismaMock.automation.findFirst).toHaveBeenCalledWith({
        where: {
          id: campaign.id,
          companyId,
          type: 'CAMPAIGN',
          isActive: true,
        },
      });
      expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
        where: {
          companyId,
          isActiveForAutomation: true,
          id: {
            in: ['customer-1', 'customer-2'],
          },
        },
      });
    });

    it('não enfileira customer inativo, inelegível ou de outro tenant', async () => {
      prismaMock.customer.findMany.mockResolvedValue([]);

      await service.enqueueCampaign(companyId, campaign.id, {
        customerIds: ['ineligible-customer'],
        content: 'Oferta',
      });

      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
    });

    it('gera exatamente uma mensagem por customer elegível', async () => {
      const secondCustomer = {
        ...customer,
        id: 'customer-2',
        name: 'Maria',
        phone: '5545888888888',
      };
      prismaMock.customer.findMany.mockResolvedValue([
        customer,
        secondCustomer,
      ]);

      await service.enqueueCampaign(companyId, campaign.id, {
        mediaAssetId: 'media-asset-1',
      });

      expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(2);
      expect(
        queueServiceMock.enqueue.mock.calls.map(([input]) => input.customerId),
      ).toEqual(['customer-1', 'customer-2']);
    });

    it('não duplica customer quando a mesma campanha é reprocessada com mensagem ativa', async () => {
      prismaMock.outboundMessage.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'outbound-message-1' });

      await service.enqueueCampaign(companyId, campaign.id, {
        content: 'Oferta para {{ nome }}',
      });
      await service.enqueueCampaign(companyId, campaign.id, {
        content: 'Oferta para {{ nome }}',
      });

      expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(1);
      expect(queueServiceMock.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'campaign:campaign-automation-1:customer:customer-1',
        }),
      );
    });

    it('rejeita automation CAMPAIGN inexistente, inativa ou de outro tenant', async () => {
      prismaMock.automation.findFirst.mockResolvedValue(null);

      await expect(
        service.enqueueCampaign(companyId, campaign.id, {
          content: 'Oferta',
        }),
      ).rejects.toThrow(new NotFoundException('Campanha não encontrada'));

      expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('unknown contact policy enforcement', () => {
    const campaign = {
      ...automation,
      id: 'policy-campaign-1',
      type: 'CAMPAIGN',
      message: null,
    };

    it('allows active UNKNOWN under ALLOW_UNKNOWN_WITH_DECLARATION', async () => {
      await service.handleReactivation(automation);

      expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(1);
      expect(prismaMock.company.findUnique).toHaveBeenCalledTimes(1);
    });

    it('blocks active UNKNOWN under BLOCK_UNKNOWN', async () => {
      prismaMock.company.findUnique.mockResolvedValue({
        unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
      });

      await service.handleReactivation(automation);

      expect(prismaMock.messageLog.findFirst).not.toHaveBeenCalled();
      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
    });

    it('keeps active GRANTED eligible under BLOCK_UNKNOWN', async () => {
      prismaMock.company.findUnique.mockResolvedValue({
        unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
      });
      prismaMock.customer.findMany.mockResolvedValue([
        {
          ...customer,
          contactConsentStatus: CustomerContactConsentStatus.GRANTED,
        },
      ]);

      await service.handleReactivation(automation);

      expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(1);
    });

    it('queries Company policy once for multiple recurring customers', async () => {
      prismaMock.customer.findMany.mockResolvedValue([
        customer,
        { ...customer, id: 'customer-2' },
      ]);

      await service.handleReactivation(automation);

      expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(2);
      expect(prismaMock.company.findUnique).toHaveBeenCalledTimes(1);
    });

    it('fails closed when the Company cannot be found', async () => {
      prismaMock.company.findUnique.mockResolvedValue(null);

      await service.handleReactivation(automation);

      expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
    });

    it('applies BLOCK_UNKNOWN to birthday automation', async () => {
      prismaMock.company.findUnique.mockResolvedValue({
        unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
      });

      await service.handleBirthday({ ...automation, type: 'BIRTHDAY' });

      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
    });

    it('queries policy once and keeps ALL_ELIGIBLE counters policy-aware', async () => {
      prismaMock.automation.findFirst.mockResolvedValue(campaign);
      prismaMock.company.findUnique.mockResolvedValue({
        unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
      });
      prismaMock.customer.findMany.mockResolvedValue([
        customer,
        {
          ...customer,
          id: 'customer-granted',
          contactConsentStatus: CustomerContactConsentStatus.GRANTED,
        },
        {
          ...customer,
          id: 'customer-opted-out',
          contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
        },
      ]);

      const result = await service.enqueueCampaign(companyId, campaign.id, {
        content: 'Offer',
      });

      expect(result).toEqual({ eligibleCustomers: 1, processed: 1 });
      expect(queueServiceMock.enqueue).toHaveBeenCalledTimes(1);
      expect(queueServiceMock.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'customer-granted' }),
      );
      expect(prismaMock.company.findUnique).toHaveBeenCalledTimes(1);
    });

    it('applies the same policy to explicit campaign customerIds', async () => {
      const grantedCustomer = {
        ...customer,
        id: 'customer-granted',
        contactConsentStatus: CustomerContactConsentStatus.GRANTED,
      };
      prismaMock.automation.findFirst.mockResolvedValue(campaign);
      prismaMock.company.findUnique.mockResolvedValue({
        unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
      });
      prismaMock.customer.findMany.mockResolvedValue([
        customer,
        grantedCustomer,
      ]);

      const result = await service.enqueueCampaign(companyId, campaign.id, {
        customerIds: [customer.id, grantedCustomer.id],
        content: 'Offer',
      });

      expect(result).toEqual({ eligibleCustomers: 1, processed: 1 });
      expect(queueServiceMock.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: grantedCustomer.id }),
      );
    });

    it('returns zero campaign counters when the Company cannot be found', async () => {
      prismaMock.automation.findFirst.mockResolvedValue(campaign);
      prismaMock.company.findUnique.mockResolvedValue(null);

      await expect(
        service.enqueueCampaign(companyId, campaign.id, { content: 'Offer' }),
      ).resolves.toEqual({ eligibleCustomers: 0, processed: 0 });
      expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
      expect(queueServiceMock.enqueue).not.toHaveBeenCalled();
    });
  });
});
