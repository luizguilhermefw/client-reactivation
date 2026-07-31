import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OutboundMessageSource, OutboundMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from './queue.service';

describe('QueueService', () => {
  let service: QueueService;

  const prismaMock = {
    company: {
      findUnique: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
    },
    automation: {
      findFirst: jest.fn(),
    },
    outboundMessage: {
      upsert: jest.fn(),
    },
  };

  const companyId = 'company-1';
  const customerId = 'customer-1';
  const automationId = 'automation-1';

  const baseInput = {
    companyId,
    customerId,
    automationId,
    source: OutboundMessageSource.AUTOMATION,
    recipientPhone: '5545999999999',
    content: 'Olá, Luiz!',
    idempotencyKey: 'automation:automation-1:customer:customer-1:2026-07-25',
  };

  const outboundMessage = {
    id: 'outbound-message-1',
    companyId,
    customerId,
    automationId,
    source: OutboundMessageSource.AUTOMATION,
    status: OutboundMessageStatus.PENDING,
    recipientPhone: '5545999999999',
    content: 'Olá, Luiz!',
    payload: null,
    scheduledAt: new Date(),
    availableAt: new Date(),
    processingAt: null,
    sentAt: null,
    failedAt: null,
    attempts: 0,
    maxAttempts: 3,
    priority: 0,
    lockedAt: null,
    lockedBy: null,
    provider: null,
    providerMessageId: null,
    lastError: null,
    lastErrorCode: null,
    idempotencyKey: 'automation:automation-1:customer:customer-1:2026-07-25',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new QueueService(prismaMock as unknown as PrismaService);

    prismaMock.company.findUnique.mockResolvedValue({
      id: companyId,
    });

    prismaMock.customer.findFirst.mockResolvedValue({
      id: customerId,
    });

    prismaMock.automation.findFirst.mockResolvedValue({
      id: automationId,
    });

    prismaMock.outboundMessage.upsert.mockResolvedValue(outboundMessage);
  });

  it('deve enfileirar uma mensagem com valores padrão', async () => {
    const result = await service.enqueue(baseInput);

    expect(result).toEqual(outboundMessage);

    expect(prismaMock.company.findUnique).toHaveBeenCalledWith({
      where: {
        id: companyId,
      },
      select: {
        id: true,
      },
    });

    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
      where: {
        id: customerId,
        companyId,
      },
      select: {
        id: true,
      },
    });

    expect(prismaMock.automation.findFirst).toHaveBeenCalledWith({
      where: {
        id: automationId,
        companyId,
      },
      select: {
        id: true,
      },
    });

    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledTimes(1);

    const upsertCall = prismaMock.outboundMessage.upsert.mock.calls[0][0];

    expect(upsertCall.where).toEqual({
      companyId_idempotencyKey: {
        companyId,
        idempotencyKey: baseInput.idempotencyKey,
      },
    });

    expect(upsertCall.update).toEqual({});

    expect(upsertCall.create).toEqual(
      expect.objectContaining({
        companyId,
        customerId,
        automationId,
        source: OutboundMessageSource.AUTOMATION,
        status: OutboundMessageStatus.PENDING,
        recipientPhone: baseInput.recipientPhone,
        content: baseInput.content,
        priority: 0,
        maxAttempts: 3,
        idempotencyKey: baseInput.idempotencyKey,
      }),
    );

    expect(upsertCall.create.scheduledAt).toBeInstanceOf(Date);
    expect(upsertCall.create.availableAt).toEqual(
      upsertCall.create.scheduledAt,
    );
  });

  it('deve respeitar agendamento, prioridade e limite de tentativas', async () => {
    const scheduledAt = new Date('2026-07-25T15:00:00.000Z');

    await service.enqueue({
      ...baseInput,
      scheduledAt,
      priority: 10,
      maxAttempts: 5,
    });

    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          scheduledAt,
          availableAt: scheduledAt,
          priority: 10,
          maxAttempts: 5,
        }),
      }),
    );
  });

  it('deve retornar a mensagem existente pela chave de idempotência', async () => {
    const existingMessage = {
      ...outboundMessage,
      status: OutboundMessageStatus.SENT,
      sentAt: new Date(),
    };

    prismaMock.outboundMessage.upsert.mockResolvedValue(existingMessage);

    const result = await service.enqueue(baseInput);

    expect(result).toEqual(existingMessage);

    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {},
      }),
    );
  });

  it('deve rejeitar empresa inexistente', async () => {
    prismaMock.company.findUnique.mockResolvedValue(null);

    await expect(service.enqueue(baseInput)).rejects.toThrow(
      new NotFoundException('Empresa não encontrada'),
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve rejeitar cliente que não pertence à empresa', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(null);

    await expect(service.enqueue(baseInput)).rejects.toThrow(
      new NotFoundException('Cliente não encontrado para esta empresa'),
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve rejeitar automação que não pertence à empresa', async () => {
    prismaMock.automation.findFirst.mockResolvedValue(null);

    await expect(service.enqueue(baseInput)).rejects.toThrow(
      new NotFoundException('Automação não encontrada para esta empresa'),
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve permitir mensagem sem cliente e sem automação', async () => {
    const input = {
      companyId,
      source: OutboundMessageSource.MANUAL,
      recipientPhone: '5545888888888',
      content: 'Mensagem manual',
      idempotencyKey: 'manual:company-1:message-1',
    };

    await service.enqueue(input);

    expect(prismaMock.customer.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.automation.findFirst).not.toHaveBeenCalled();

    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          companyId,
          customerId: undefined,
          automationId: undefined,
          source: OutboundMessageSource.MANUAL,
        }),
      }),
    );
  });

  it.each([
    {
      field: 'companyId',
      value: '',
      message: 'companyId é obrigatório',
    },
    {
      field: 'recipientPhone',
      value: '   ',
      message: 'recipientPhone é obrigatório',
    },
    {
      field: 'content',
      value: '',
      message: 'content é obrigatório',
    },
    {
      field: 'idempotencyKey',
      value: '',
      message: 'idempotencyKey é obrigatório',
    },
  ])('deve rejeitar $field inválido', async ({ field, value, message }) => {
    await expect(
      service.enqueue({
        ...baseInput,
        [field]: value,
      }),
    ).rejects.toThrow(new BadRequestException(message));

    expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve rejeitar prioridade negativa', async () => {
    await expect(
      service.enqueue({
        ...baseInput,
        priority: -1,
      }),
    ).rejects.toThrow(
      new BadRequestException('priority não pode ser menor que zero'),
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve rejeitar maxAttempts menor que um', async () => {
    await expect(
      service.enqueue({
        ...baseInput,
        maxAttempts: 0,
      }),
    ).rejects.toThrow(
      new BadRequestException('maxAttempts deve ser maior ou igual a um'),
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve rejeitar scheduledAt inválido', async () => {
    await expect(
      service.enqueue({
        ...baseInput,
        scheduledAt: new Date('data-inválida'),
      }),
    ).rejects.toThrow(new BadRequestException('scheduledAt é inválido'));

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });
});
