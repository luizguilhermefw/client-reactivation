import { Logger } from '@nestjs/common';
import {
  OutboundMessage,
  OutboundMessageSource,
  OutboundMessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageWorkerService } from './message-worker.service';

describe('MessageWorkerService', () => {
  let service: MessageWorkerService;

  const prismaMock = {
    outboundMessage: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const now = new Date('2026-07-30T15:00:00.000Z');
  const companyId = 'company-1';

  const pendingMessage: OutboundMessage = {
    id: 'message-1',
    companyId,
    customerId: 'customer-1',
    automationId: 'automation-1',
    source: OutboundMessageSource.AUTOMATION,
    status: OutboundMessageStatus.PENDING,
    recipientPhone: '5545999999999',
    content: 'Mensagem',
    payload: null,
    scheduledAt: now,
    availableAt: now,
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
    idempotencyKey: 'message-1',
    createdAt: now,
    updatedAt: now,
  };

  const acquiredMessage = (attempts = 1, maxAttempts = 3): OutboundMessage => ({
    ...pendingMessage,
    status: OutboundMessageStatus.PROCESSING,
    processingAt: now,
    lockedAt: now,
    lockedBy: expect.any(String) as unknown as string,
    attempts,
    maxAttempts,
  });

  const mockQueueQueries = (
    expiredLocks: Array<{ id: string; companyId: string }> = [],
    pendingMessages: Array<{ id: string; companyId: string }> = [
      {
        id: pendingMessage.id,
        companyId,
      },
    ],
  ): void => {
    prismaMock.outboundMessage.findMany.mockImplementation(
      ({ where }: { where: { status: OutboundMessageStatus } }) =>
        Promise.resolve(
          where.status === OutboundMessageStatus.PROCESSING
            ? expiredLocks
            : pendingMessages,
        ),
    );
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();

    service = new MessageWorkerService(prismaMock as unknown as PrismaService);

    mockQueueQueries();
    prismaMock.outboundMessage.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaMock.outboundMessage.findFirst.mockResolvedValue(acquiredMessage());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('não faz aquisições quando não há mensagem disponível', async () => {
    mockQueueQueries([], []);

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.outboundMessage.findFirst).not.toHaveBeenCalled();
  });

  it('não atualiza nem registra recuperação quando não há locks expirados', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    mockQueueQueries([], []);

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).not.toHaveBeenCalled();
    expect(loggerSpy).not.toHaveBeenCalled();
  });

  it('busca até cinquenta locks expirados há cinco minutos antes das mensagens pendentes', async () => {
    mockQueueQueries([], []);

    await service.handleCron();

    expect(prismaMock.outboundMessage.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: OutboundMessageStatus.PROCESSING,
        lockedAt: {
          not: null,
          lte: new Date('2026-07-30T14:55:00.000Z'),
        },
      },
      take: 50,
      select: {
        id: true,
        companyId: true,
      },
    });
    expect(
      prismaMock.outboundMessage.findMany.mock.calls[1][0].where.status,
    ).toBe(OutboundMessageStatus.PENDING);
  });

  it('recupera um lock expirado com filtro multi-tenant e estado operacional limpo', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    mockQueueQueries(
      [
        {
          id: 'expired-message-1',
          companyId,
        },
      ],
      [],
    );

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'expired-message-1',
        companyId,
        status: OutboundMessageStatus.PROCESSING,
        lockedAt: {
          lte: new Date('2026-07-30T14:55:00.000Z'),
        },
      },
      data: {
        status: OutboundMessageStatus.PENDING,
        processingAt: null,
        lockedAt: null,
        lockedBy: null,
        availableAt: now,
        lastError: 'Worker lock expired before processing completion',
        lastErrorCode: 'WORKER_LOCK_EXPIRED',
      },
    });

    const recovery = prismaMock.outboundMessage.updateMany.mock.calls[0][0];
    expect(recovery.data).not.toHaveProperty('attempts');
    expect(loggerSpy).toHaveBeenCalledWith(
      'Recovered 1 expired outbound message lock(s)',
    );
  });

  it('não contabiliza count zero como lock recuperado', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    mockQueueQueries(
      [
        {
          id: 'expired-message-1',
          companyId,
        },
      ],
      [],
    );
    prismaMock.outboundMessage.updateMany.mockResolvedValue({
      count: 0,
    });

    await service.handleCron();

    expect(loggerSpy).not.toHaveBeenCalled();
  });

  it('continua recuperando locks quando um candidato falha', async () => {
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    mockQueueQueries(
      [
        {
          id: 'expired-message-1',
          companyId,
        },
        {
          id: 'expired-message-2',
          companyId,
        },
      ],
      [],
    );
    prismaMock.outboundMessage.updateMany
      .mockRejectedValueOnce(new Error('Database update failed'))
      .mockResolvedValueOnce({
        count: 1,
      });

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.outboundMessage.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'expired-message-2',
          companyId,
        }),
      }),
    );
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(loggerLogSpy).toHaveBeenCalledWith(
      'Recovered 1 expired outbound message lock(s)',
    );
  });

  it('continua processando a fila quando a busca de locks expirados falha', async () => {
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    prismaMock.outboundMessage.findMany
      .mockRejectedValueOnce(new Error('Database query failed'))
      .mockResolvedValueOnce([
        {
          id: pendingMessage.id,
          companyId,
        },
      ]);

    await service.handleCron();

    expect(prismaMock.outboundMessage.findMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.outboundMessage.findFirst).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to find expired message locks',
      expect.any(String),
    );
  });

  it('adquire uma mensagem elegível de forma condicional', async () => {
    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: pendingMessage.id,
        companyId,
        status: OutboundMessageStatus.PENDING,
        lockedAt: null,
        availableAt: {
          lte: now,
        },
      },
      data: {
        status: OutboundMessageStatus.PROCESSING,
        processingAt: now,
        lockedAt: now,
        lockedBy: expect.any(String),
        attempts: {
          increment: 1,
        },
      },
    });

    expect(prismaMock.outboundMessage.findFirst).toHaveBeenCalledWith({
      where: {
        id: pendingMessage.id,
        companyId,
        status: OutboundMessageStatus.PROCESSING,
        lockedBy: expect.any(String),
      },
    });
  });

  it('não carrega nem processa a mensagem quando a aquisição retorna count zero', async () => {
    prismaMock.outboundMessage.updateMany.mockResolvedValue({
      count: 0,
    });

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.outboundMessage.findFirst).not.toHaveBeenCalled();
  });

  it('libera a mensagem quando findFirst retorna null depois da aquisição', async () => {
    prismaMock.outboundMessage.findFirst.mockResolvedValue(null);

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: pendingMessage.id,
        companyId,
        status: OutboundMessageStatus.PROCESSING,
        lockedBy: expect.any(String),
      },
      data: {
        status: OutboundMessageStatus.PENDING,
        processingAt: null,
        lockedAt: null,
        lockedBy: null,
        availableAt: new Date('2026-07-30T15:01:00.000Z'),
        lastError: 'Acquired message could not be loaded',
        lastErrorCode: 'WORKER_PROCESSING_ERROR',
      },
    });
  });

  it('libera a mensagem quando findFirst lança erro depois da aquisição', async () => {
    prismaMock.outboundMessage.findFirst.mockRejectedValue(
      new Error('Database read failed'),
    );

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: pendingMessage.id,
        companyId,
        status: OutboundMessageStatus.PROCESSING,
        lockedBy: expect.any(String),
      },
      data: {
        status: OutboundMessageStatus.PENDING,
        processingAt: null,
        lockedAt: null,
        lockedBy: null,
        availableAt: new Date('2026-07-30T15:01:00.000Z'),
        lastError: 'Message processing failed after acquisition',
        lastErrorCode: 'WORKER_PROCESSING_ERROR',
      },
    });
  });

  it('continua o lote quando uma mensagem falha depois da aquisição', async () => {
    mockQueueQueries(
      [],
      [
        {
          id: pendingMessage.id,
          companyId,
        },
        {
          id: 'message-2',
          companyId,
        },
      ],
    );
    prismaMock.outboundMessage.findFirst
      .mockRejectedValueOnce(new Error('Database read failed'))
      .mockResolvedValueOnce({
        ...acquiredMessage(),
        id: 'message-2',
      });

    await service.handleCron();

    expect(prismaMock.outboundMessage.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMock.outboundMessage.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'message-2',
          companyId,
          status: OutboundMessageStatus.PENDING,
        }),
      }),
    );
  });

  it('libera por companyId e workerId sem incrementar attempts novamente', async () => {
    prismaMock.outboundMessage.findFirst.mockResolvedValue(null);

    await service.handleCron();

    const release = prismaMock.outboundMessage.updateMany.mock.calls[1][0];

    expect(release.where).toEqual({
      id: pendingMessage.id,
      companyId,
      status: OutboundMessageStatus.PROCESSING,
      lockedBy: expect.any(String),
    });
    expect(release.data).toEqual(
      expect.objectContaining({
        processingAt: null,
        lockedAt: null,
        lockedBy: null,
      }),
    );
    expect(release.data).not.toHaveProperty('attempts');
  });

  it('incrementa attempts ao adquirir a mensagem', async () => {
    await service.handleCron();

    expect(
      prismaMock.outboundMessage.updateMany.mock.calls[0][0].data.attempts,
    ).toEqual({
      increment: 1,
    });
  });

  it('busca o lote na ordem correta e limitado a dez mensagens', async () => {
    await service.handleCron();

    expect(prismaMock.outboundMessage.findMany).toHaveBeenCalledWith({
      where: {
        status: OutboundMessageStatus.PENDING,
        lockedAt: null,
        availableAt: {
          lte: now,
        },
      },
      orderBy: [
        {
          priority: 'desc',
        },
        {
          availableAt: 'asc',
        },
        {
          createdAt: 'asc',
        },
      ],
      take: 10,
      select: {
        id: true,
        companyId: true,
      },
    });
  });

  it('libera para retry em um minuto após a primeira tentativa', async () => {
    prismaMock.outboundMessage.findFirst.mockResolvedValue(
      acquiredMessage(1, 3),
    );

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: pendingMessage.id,
        companyId,
        status: OutboundMessageStatus.PROCESSING,
        lockedBy: expect.any(String),
      },
      data: {
        status: OutboundMessageStatus.PENDING,
        processingAt: null,
        lockedAt: null,
        lockedBy: null,
        lastError: 'Message provider is not configured',
        lastErrorCode: 'PROVIDER_NOT_CONFIGURED',
        availableAt: new Date('2026-07-30T15:01:00.000Z'),
      },
    });
  });

  it('aplica os backoffs de cinco e quinze minutos', async () => {
    prismaMock.outboundMessage.findFirst
      .mockResolvedValueOnce(acquiredMessage(2, 4))
      .mockResolvedValueOnce({
        ...acquiredMessage(3, 4),
        id: 'message-2',
      });
    mockQueueQueries(
      [],
      [
        {
          id: pendingMessage.id,
          companyId,
        },
        {
          id: 'message-2',
          companyId,
        },
      ],
    );

    await service.handleCron();

    expect(
      prismaMock.outboundMessage.updateMany.mock.calls[1][0].data.availableAt,
    ).toEqual(new Date('2026-07-30T15:05:00.000Z'));
    expect(
      prismaMock.outboundMessage.updateMany.mock.calls[3][0].data.availableAt,
    ).toEqual(new Date('2026-07-30T15:15:00.000Z'));
  });

  it('marca como FAILED ao atingir maxAttempts', async () => {
    prismaMock.outboundMessage.findFirst.mockResolvedValue(
      acquiredMessage(3, 3),
    );

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: pendingMessage.id,
        companyId,
        status: OutboundMessageStatus.PROCESSING,
        lockedBy: expect.any(String),
      },
      data: {
        status: OutboundMessageStatus.FAILED,
        failedAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: 'Message provider is not configured',
        lastErrorCode: 'PROVIDER_NOT_CONFIGURED',
      },
    });
  });

  it.each([
    {
      attempts: 1,
      maxAttempts: 3,
      expectedStatus: OutboundMessageStatus.PENDING,
    },
    {
      attempts: 3,
      maxAttempts: 3,
      expectedStatus: OutboundMessageStatus.FAILED,
    },
  ])(
    'limpa o lock ao concluir uma tentativa com status $expectedStatus',
    async ({ attempts, maxAttempts, expectedStatus }) => {
      prismaMock.outboundMessage.findFirst.mockResolvedValue(
        acquiredMessage(attempts, maxAttempts),
      );

      await service.handleCron();

      expect(prismaMock.outboundMessage.updateMany.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            status: expectedStatus,
            lockedAt: null,
            lockedBy: null,
          }),
        }),
      );
    },
  );

  it('inclui companyId em todos os filtros de atualização operacional', async () => {
    await service.handleCron();

    for (const [operation] of prismaMock.outboundMessage.updateMany.mock
      .calls) {
      expect(operation.where).toEqual(
        expect.objectContaining({
          companyId,
        }),
      );
    }
  });

  it('nunca marca uma mensagem como SENT sem provider', async () => {
    await service.handleCron();

    for (const [operation] of prismaMock.outboundMessage.updateMany.mock
      .calls) {
      expect(operation.data.status).not.toBe(OutboundMessageStatus.SENT);
    }
  });

  it('impede sobreposição de execuções na mesma instância', async () => {
    let resolveFindMany: (
      value: Array<{ id: string; companyId: string }>,
    ) => void;
    const pendingFindMany = new Promise<
      Array<{ id: string; companyId: string }>
    >((resolve) => {
      resolveFindMany = resolve;
    });
    prismaMock.outboundMessage.findMany.mockReturnValue(pendingFindMany);

    const firstExecution = service.handleCron();
    await service.handleCron();

    expect(prismaMock.outboundMessage.findMany).toHaveBeenCalledTimes(1);

    resolveFindMany!([]);
    await firstExecution;
  });
});
