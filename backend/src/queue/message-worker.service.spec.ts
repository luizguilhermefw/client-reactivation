import { Logger } from '@nestjs/common';
import {
  LogStatus,
  OutboundMessage,
  OutboundMessageSource,
  OutboundMessageStatus,
  OutboundMessageType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageProvider } from '../message-provider/contracts/message-provider.interface';
import { MessageProviderError } from '../message-provider/contracts/message-provider.types';
import { MessageWorkerService } from './message-worker.service';
import {
  EnvQueueWorkerConfig,
  QueueWorkerConfig,
} from './queue-worker.config';

describe('MessageWorkerService', () => {
  let service: MessageWorkerService;

  const transactionMock = {
    outboundMessage: {
      updateMany: jest.fn(),
    },
    messageLog: {
      create: jest.fn(),
    },
  };

  const prismaMock = {
    outboundMessage: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const messageProviderMock: jest.Mocked<MessageProvider> = {
    sendText: jest.fn(),
  };

  const queueWorkerConfigMock: jest.Mocked<QueueWorkerConfig> = {
    isEnabled: jest.fn(),
  };

  const now = new Date('2026-07-30T15:00:00.000Z');
  const companyId = 'company-1';

  const pendingMessage: OutboundMessage = {
    id: 'message-1',
    companyId,
    customerId: 'customer-1',
    automationId: 'automation-1',
    source: OutboundMessageSource.AUTOMATION,
    type: OutboundMessageType.TEXT,
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
    lockedBy: 'current-worker',
    attempts,
    maxAttempts,
  });

  const acquiredImageMessage = (): OutboundMessage => ({
    ...acquiredMessage(),
    type: OutboundMessageType.IMAGE,
    content: '',
    payload: {
      mediaUrl: 'https://media.example.com/campanha.jpg',
      mimeType: 'image/jpeg',
      fileName: 'campanha.jpg',
      fileSize: 123_456,
      caption: 'Legenda privada',
    },
  });

  const mockQueueQueries = (
    expiredLocks: Array<{ id: string; companyId: string }> = [],
    pendingMessages: Array<{ id: string; companyId: string }> = [
      { id: pendingMessage.id, companyId },
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

  const retryableError = () =>
    new MessageProviderError('Provider temporarily unavailable', {
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });

  const definitiveError = () =>
    new MessageProviderError('Invalid message request', {
      code: 'INVALID_MESSAGE_REQUEST',
      retryable: false,
    });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();

    service = new MessageWorkerService(
      prismaMock as unknown as PrismaService,
      messageProviderMock,
      queueWorkerConfigMock,
    );

    queueWorkerConfigMock.isEnabled.mockReturnValue(true);
    mockQueueQueries();
    prismaMock.outboundMessage.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.outboundMessage.findFirst.mockResolvedValue(acquiredMessage());
    transactionMock.outboundMessage.updateMany.mockResolvedValue({ count: 1 });
    transactionMock.messageLog.create.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(
      (callback: (transaction: typeof transactionMock) => Promise<unknown>) =>
        callback(transactionMock),
    );
    messageProviderMock.sendText.mockResolvedValue({
      provider: 'evolution',
      providerMessageId: 'provider-message-1',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('does not acquire or call the provider when no message is available', async () => {
    mockQueueQueries([], []);

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.outboundMessage.findFirst).not.toHaveBeenCalled();
    expect(messageProviderMock.sendText).not.toHaveBeenCalled();
  });

  it('keeps the worker disabled by default without queue side effects', async () => {
    service = new MessageWorkerService(
      prismaMock as unknown as PrismaService,
      messageProviderMock,
      new EnvQueueWorkerConfig(() => undefined),
    );
    const recoverExpiredLocksSpy = jest.spyOn(
      service as unknown as { recoverExpiredLocks(): Promise<void> },
      'recoverExpiredLocks',
    );
    const loggerWarnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await service.handleCron();
    await service.handleCron();

    expect(recoverExpiredLocksSpy).not.toHaveBeenCalled();
    expect(prismaMock.outboundMessage.findMany).not.toHaveBeenCalled();
    expect(prismaMock.outboundMessage.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.outboundMessage.updateMany).not.toHaveBeenCalled();
    expect(messageProviderMock.sendText).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(loggerWarnSpy).not.toHaveBeenCalled();
  });

  it('keeps the existing processing flow when the worker is enabled', async () => {
    await service.handleCron();

    expect(queueWorkerConfigMock.isEnabled).toHaveBeenCalledTimes(1);
    expect(prismaMock.outboundMessage.findMany).toHaveBeenCalled();
    expect(messageProviderMock.sendText).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not update or log recovery when there are no expired locks', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    mockQueueQueries([], []);

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).not.toHaveBeenCalled();
    expect(loggerSpy).not.toHaveBeenCalled();
  });

  it('searches up to fifty five-minute-old locks before pending messages', async () => {
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
      select: { id: true, companyId: true },
    });
    expect(
      prismaMock.outboundMessage.findMany.mock.calls[1][0].where.status,
    ).toBe(OutboundMessageStatus.PENDING);
  });

  it('recovers an expired lock with tenant guard and clean operational state', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    mockQueueQueries([{ id: 'expired-message-1', companyId }], []);

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'expired-message-1',
        companyId,
        status: OutboundMessageStatus.PROCESSING,
        lockedAt: { lte: new Date('2026-07-30T14:55:00.000Z') },
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
    expect(
      prismaMock.outboundMessage.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('attempts');
    expect(loggerSpy).toHaveBeenCalledWith(
      'Recovered 1 expired outbound message lock(s)',
    );
  });

  it('does not count a zero update as a recovered lock', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    mockQueueQueries([{ id: 'expired-message-1', companyId }], []);
    prismaMock.outboundMessage.updateMany.mockResolvedValue({ count: 0 });

    await service.handleCron();

    expect(loggerSpy).not.toHaveBeenCalled();
  });

  it('continues recovering locks when one candidate fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    mockQueueQueries(
      [
        { id: 'expired-message-1', companyId },
        { id: 'expired-message-2', companyId },
      ],
      [],
    );
    prismaMock.outboundMessage.updateMany
      .mockRejectedValueOnce(new Error('Database update failed'))
      .mockResolvedValueOnce({ count: 1 });

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
    expect(loggerSpy).toHaveBeenCalledWith(
      'Recovered 1 expired outbound message lock(s)',
    );
  });

  it('continues processing pending messages when expired-lock lookup fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prismaMock.outboundMessage.findMany
      .mockRejectedValueOnce(new Error('Database query failed'))
      .mockResolvedValueOnce([{ id: pendingMessage.id, companyId }]);

    await service.handleCron();

    expect(prismaMock.outboundMessage.findMany).toHaveBeenCalledTimes(2);
    expect(messageProviderMock.sendText).toHaveBeenCalledTimes(1);
  });

  it('conditionally acquires an eligible message and increments attempts', async () => {
    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: pendingMessage.id,
        companyId,
        status: OutboundMessageStatus.PENDING,
        lockedAt: null,
        availableAt: { lte: now },
      },
      data: {
        status: OutboundMessageStatus.PROCESSING,
        processingAt: now,
        lockedAt: now,
        lockedBy: expect.any(String),
        attempts: { increment: 1 },
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

  it('does not load, process, or call the provider when acquisition returns zero', async () => {
    prismaMock.outboundMessage.updateMany.mockResolvedValue({ count: 0 });

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.outboundMessage.findFirst).not.toHaveBeenCalled();
    expect(messageProviderMock.sendText).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('safely releases a message when it cannot be loaded after acquisition', async () => {
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
    expect(
      prismaMock.outboundMessage.updateMany.mock.calls[1][0].data,
    ).not.toHaveProperty('attempts');
    expect(messageProviderMock.sendText).not.toHaveBeenCalled();
  });

  it('safely releases a message when loading throws after acquisition', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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

  it('continues the batch when one message fails after acquisition', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockQueueQueries([], [
      { id: pendingMessage.id, companyId },
      { id: 'message-2', companyId },
    ]);
    prismaMock.outboundMessage.findFirst
      .mockRejectedValueOnce(new Error('Database read failed'))
      .mockResolvedValueOnce({ ...acquiredMessage(), id: 'message-2' });

    await service.handleCron();

    expect(prismaMock.outboundMessage.findFirst).toHaveBeenCalledTimes(2);
    expect(messageProviderMock.sendText).toHaveBeenCalledTimes(1);
    expect(messageProviderMock.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: pendingMessage.idempotencyKey }),
    );
  });

  it('queries pending messages in priority order with a batch limit of ten', async () => {
    await service.handleCron();

    expect(prismaMock.outboundMessage.findMany).toHaveBeenCalledWith({
      where: {
        status: OutboundMessageStatus.PENDING,
        lockedAt: null,
        availableAt: { lte: now },
      },
      orderBy: [
        { priority: 'desc' },
        { availableAt: 'asc' },
        { createdAt: 'asc' },
      ],
      take: 10,
      select: { id: true, companyId: true },
    });
  });

  it('calls the injected provider once with the message delivery fields', async () => {
    await service.handleCron();

    expect(messageProviderMock.sendText).toHaveBeenCalledTimes(1);
    expect(messageProviderMock.sendText).toHaveBeenCalledWith({
      companyId,
      recipientPhone: pendingMessage.recipientPhone,
      content: pendingMessage.content,
      idempotencyKey: pendingMessage.idempotencyKey,
    });
  });

  it('does not call sendText or mark an IMAGE message as SENT', async () => {
    prismaMock.outboundMessage.findFirst.mockResolvedValue(
      acquiredImageMessage(),
    );

    await service.handleCron();

    expect(messageProviderMock.sendText).not.toHaveBeenCalled();
    expect(transactionMock.outboundMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OutboundMessageStatus.FAILED,
        }),
      }),
    );
    expect(
      transactionMock.outboundMessage.updateMany.mock.calls[0][0].data.status,
    ).not.toBe(OutboundMessageStatus.SENT);
  });

  it('fails IMAGE safely and non-retryably without exposing delivery data', async () => {
    const imageMessage = acquiredImageMessage();
    const loggerSpies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
    ];
    prismaMock.outboundMessage.findFirst.mockResolvedValue(imageMessage);

    await service.handleCron();

    expect(prismaMock.outboundMessage.updateMany).toHaveBeenCalledTimes(1);
    expect(transactionMock.outboundMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OutboundMessageStatus.FAILED,
          lastError: 'Message type is not supported by the configured provider',
          lastErrorCode: 'UNSUPPORTED_MESSAGE_TYPE',
        }),
      }),
    );
    expect(transactionMock.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LogStatus.FAILED,
          errorMessage:
            'Message type is not supported by the configured provider',
        }),
      }),
    );

    const persistedFailure = JSON.stringify([
      transactionMock.outboundMessage.updateMany.mock.calls,
      transactionMock.messageLog.create.mock.calls,
    ]);
    expect(persistedFailure).not.toContain(imageMessage.recipientPhone);
    expect(persistedFailure).not.toContain('https://media.example.com');
    expect(persistedFailure).not.toContain('Legenda privada');

    for (const loggerSpy of loggerSpies) {
      expect(JSON.stringify(loggerSpy.mock.calls)).not.toContain(
        imageMessage.recipientPhone,
      );
      expect(JSON.stringify(loggerSpy.mock.calls)).not.toContain(
        'https://media.example.com',
      );
      expect(JSON.stringify(loggerSpy.mock.calls)).not.toContain(
        'Legenda privada',
      );
    }
  });

  it('marks a successful delivery as SENT and persists provider identifiers', async () => {
    await service.handleCron();

    expect(transactionMock.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: pendingMessage.id,
        companyId,
        status: OutboundMessageStatus.PROCESSING,
        lockedBy: expect.any(String),
      },
      data: {
        status: OutboundMessageStatus.SENT,
        sentAt: now,
        failedAt: null,
        provider: 'evolution',
        providerMessageId: 'provider-message-1',
        processingAt: null,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        lastErrorCode: null,
      },
    });
    expect(
      transactionMock.outboundMessage.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('availableAt');
  });

  it('creates exactly one terminal SENT log after a successful guarded update', async () => {
    await service.handleCron();

    expect(transactionMock.messageLog.create).toHaveBeenCalledTimes(1);
    expect(transactionMock.messageLog.create).toHaveBeenCalledWith({
      data: {
        companyId,
        customerId: pendingMessage.customerId,
        automationId: pendingMessage.automationId,
        outboundMessageId: pendingMessage.id,
        status: LogStatus.SENT,
        scheduledDate: pendingMessage.scheduledAt,
        sentAt: now,
      },
    });
    expect(
      transactionMock.outboundMessage.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(transactionMock.messageLog.create.mock.invocationCallOrder[0]);
  });

  it('uses one transaction for the SENT update and terminal log', async () => {
    await service.handleCron();

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionMock.outboundMessage.updateMany).toHaveBeenCalledTimes(1);
    expect(transactionMock.messageLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not create a SENT log when the guarded terminal update returns zero', async () => {
    transactionMock.outboundMessage.updateMany.mockResolvedValue({ count: 0 });

    await service.handleCron();

    expect(messageProviderMock.sendText).toHaveBeenCalledTimes(1);
    expect(transactionMock.messageLog.create).not.toHaveBeenCalled();
  });

  it('preserves at-least-once behavior when SENT log creation rolls back the terminal transaction', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const logError = new Error('MessageLog creation failed');
    transactionMock.messageLog.create.mockRejectedValue(logError);

    // The external send cannot be rolled back locally, so a persistence failure can cause a future redelivery.
    await service.handleCron();

    const transactionResult = prismaMock.$transaction.mock.results[0].value;

    await expect(transactionResult).rejects.toBe(logError);
    expect(transactionMock.outboundMessage.updateMany).toHaveBeenCalledTimes(1);
    expect(transactionMock.messageLog.create).toHaveBeenCalledTimes(1);
    expect(messageProviderMock.sendText).toHaveBeenCalledTimes(1);

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
    expect(
      prismaMock.outboundMessage.updateMany.mock.calls[1][0].data,
    ).not.toHaveProperty('attempts');
  });

  it('returns a retryable failure to PENDING with first-attempt backoff and no log', async () => {
    messageProviderMock.sendText.mockRejectedValue(retryableError());

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
        lastError: 'Provider temporarily unavailable',
        lastErrorCode: 'PROVIDER_UNAVAILABLE',
        availableAt: new Date('2026-07-30T15:01:00.000Z'),
      },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(transactionMock.messageLog.create).not.toHaveBeenCalled();
  });

  it('keeps the existing five and fifteen minute retry backoffs', async () => {
    mockQueueQueries([], [
      { id: pendingMessage.id, companyId },
      { id: 'message-2', companyId },
    ]);
    prismaMock.outboundMessage.findFirst
      .mockResolvedValueOnce(acquiredMessage(2, 4))
      .mockResolvedValueOnce({ ...acquiredMessage(3, 4), id: 'message-2' });
    messageProviderMock.sendText
      .mockRejectedValueOnce(retryableError())
      .mockRejectedValueOnce(retryableError());

    await service.handleCron();

    expect(
      prismaMock.outboundMessage.updateMany.mock.calls[1][0].data.availableAt,
    ).toEqual(new Date('2026-07-30T15:05:00.000Z'));
    expect(
      prismaMock.outboundMessage.updateMany.mock.calls[3][0].data.availableAt,
    ).toEqual(new Date('2026-07-30T15:15:00.000Z'));
  });

  it('immediately marks a non-retryable provider failure as FAILED', async () => {
    messageProviderMock.sendText.mockRejectedValue(definitiveError());

    await service.handleCron();

    expect(transactionMock.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: pendingMessage.id,
        companyId,
        status: OutboundMessageStatus.PROCESSING,
        lockedBy: expect.any(String),
      },
      data: {
        status: OutboundMessageStatus.FAILED,
        failedAt: now,
        sentAt: null,
        processingAt: null,
        lockedAt: null,
        lockedBy: null,
        lastError: 'Invalid message request',
        lastErrorCode: 'INVALID_MESSAGE_REQUEST',
      },
    });
    const failedUpdate =
      transactionMock.outboundMessage.updateMany.mock.calls[0][0].data;
    expect(failedUpdate).not.toHaveProperty('availableAt');
    expect(failedUpdate).not.toHaveProperty('provider');
    expect(failedUpdate).not.toHaveProperty('providerMessageId');
  });

  it('creates a FAILED log in the same transaction as the terminal update', async () => {
    messageProviderMock.sendText.mockRejectedValue(definitiveError());

    await service.handleCron();

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionMock.messageLog.create).toHaveBeenCalledWith({
      data: {
        companyId,
        customerId: pendingMessage.customerId,
        automationId: pendingMessage.automationId,
        outboundMessageId: pendingMessage.id,
        status: LogStatus.FAILED,
        scheduledDate: pendingMessage.scheduledAt,
        errorMessage: 'Invalid message request',
      },
    });
  });

  it('marks a retryable failure as FAILED when maxAttempts is reached', async () => {
    prismaMock.outboundMessage.findFirst.mockResolvedValue(
      acquiredMessage(3, 3),
    );
    messageProviderMock.sendText.mockRejectedValue(retryableError());

    await service.handleCron();

    expect(transactionMock.outboundMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OutboundMessageStatus.FAILED,
          lastErrorCode: 'PROVIDER_UNAVAILABLE',
        }),
      }),
    );
    expect(transactionMock.messageLog.create).toHaveBeenCalledTimes(1);
  });

  it('returns an unexpected provider error to PENDING below the attempt limit', async () => {
    messageProviderMock.sendText.mockRejectedValue(
      new Error('secret provider payload'),
    );

    await service.handleCron();

    const retry = prismaMock.outboundMessage.updateMany.mock.calls[1][0];
    expect(retry.data).toEqual(
      expect.objectContaining({
        status: OutboundMessageStatus.PENDING,
        lastError: 'Unexpected message provider error',
        lastErrorCode: 'UNEXPECTED_PROVIDER_ERROR',
      }),
    );
    expect(JSON.stringify(retry.data)).not.toContain('secret provider payload');
  });

  it('does not log external error stacks or message delivery data', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    messageProviderMock.sendText.mockRejectedValue(
      new Error(
        `api-key-secret ${pendingMessage.recipientPhone} ${pendingMessage.content}`,
      ),
    );

    await service.handleCron();

    expect(loggerSpy).not.toHaveBeenCalled();
  });

  it('marks an unexpected provider error as FAILED at the attempt limit', async () => {
    prismaMock.outboundMessage.findFirst.mockResolvedValue(
      acquiredMessage(3, 3),
    );
    messageProviderMock.sendText.mockRejectedValue(new Error('secret'));

    await service.handleCron();

    expect(transactionMock.outboundMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OutboundMessageStatus.FAILED,
          lastError: 'Unexpected message provider error',
          lastErrorCode: 'UNEXPECTED_PROVIDER_ERROR',
        }),
      }),
    );
    expect(transactionMock.messageLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not create a FAILED log when the guarded terminal update returns zero', async () => {
    messageProviderMock.sendText.mockRejectedValue(definitiveError());
    transactionMock.outboundMessage.updateMany.mockResolvedValue({ count: 0 });

    await service.handleCron();

    expect(transactionMock.messageLog.create).not.toHaveBeenCalled();
  });

  it('does not mark a message as SENT when the provider fails', async () => {
    messageProviderMock.sendText.mockRejectedValue(retryableError());

    await service.handleCron();

    for (const [operation] of [
      ...prismaMock.outboundMessage.updateMany.mock.calls,
      ...transactionMock.outboundMessage.updateMany.mock.calls,
    ]) {
      expect(operation.data.status).not.toBe(OutboundMessageStatus.SENT);
    }
  });

  it('includes companyId in every operational update filter', async () => {
    await service.handleCron();

    for (const [operation] of [
      ...prismaMock.outboundMessage.updateMany.mock.calls,
      ...transactionMock.outboundMessage.updateMany.mock.calls,
    ]) {
      expect(operation.where).toEqual(expect.objectContaining({ companyId }));
    }
  });

  it('prevents overlapping executions in the same worker instance', async () => {
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

describe('EnvQueueWorkerConfig', () => {
  it('returns false when MESSAGE_WORKER_ENABLED is absent', () => {
    const config = new EnvQueueWorkerConfig(() => undefined);

    expect(config.isEnabled()).toBe(false);
  });

  it.each([
    ['', false],
    ['false', false],
    ['0', false],
    ['yes', false],
    ['other', false],
    ['true', true],
    ['TRUE', true],
    [' true ', true],
  ])('normalizes %p to %p', (value, expected) => {
    const config = new EnvQueueWorkerConfig(() => value);

    expect(config.isEnabled()).toBe(expected);
  });
});
