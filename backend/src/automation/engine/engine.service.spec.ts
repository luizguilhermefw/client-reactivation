import {
  LogStatus,
  OutboundMessageSource,
  OutboundMessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { EngineService } from './engine.service';

describe('EngineService', () => {
  let service: EngineService;
  const originalAppTimezone = process.env.APP_TIMEZONE;

  const prismaMock = {
    automation: {
      findMany: jest.fn(),
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
    );

    prismaMock.customer.findMany.mockResolvedValue([customer]);
    prismaMock.messageLog.findFirst.mockResolvedValue(null);
    prismaMock.outboundMessage.findFirst.mockResolvedValue(null);
    prismaMock.automation.findMany.mockResolvedValue([]);
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

  it('mantém automação de reativação enfileirando clientes elegíveis', async () => {
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
});
