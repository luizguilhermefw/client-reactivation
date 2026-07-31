import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  LogStatus,
  OutboundMessage,
  OutboundMessageStatus,
} from '@prisma/client';
import { hostname } from 'node:os';
import { PrismaService } from '../../prisma/prisma.service';
import type { MessageProvider } from '../message-provider/contracts/message-provider.interface';
import {
  MessageProviderError,
  SendMessageResult,
} from '../message-provider/contracts/message-provider.types';
import { MESSAGE_PROVIDER } from '../message-provider/message-provider.token';

@Injectable()
export class MessageWorkerService {
  private static readonly BATCH_SIZE = 10;
  private static readonly EXPIRED_LOCK_BATCH_SIZE = 50;
  private static readonly LOCK_TIMEOUT_MS = 5 * 60_000;
  private static readonly LOCK_EXPIRED_ERROR =
    'Worker lock expired before processing completion';
  private static readonly LOCK_EXPIRED_ERROR_CODE = 'WORKER_LOCK_EXPIRED';
  private static readonly UNEXPECTED_PROVIDER_ERROR =
    'Unexpected message provider error';
  private static readonly UNEXPECTED_PROVIDER_ERROR_CODE =
    'UNEXPECTED_PROVIDER_ERROR';
  private static readonly MESSAGE_LOAD_ERROR =
    'Acquired message could not be loaded';
  private static readonly WORKER_PROCESSING_ERROR =
    'Message processing failed after acquisition';
  private static readonly WORKER_PROCESSING_ERROR_CODE =
    'WORKER_PROCESSING_ERROR';

  private readonly logger = new Logger(MessageWorkerService.name);
  private readonly workerId = `${hostname()}:${process.pid}`;
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGE_PROVIDER)
    private readonly messageProvider: MessageProvider,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCron(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Skipping execution because the worker is already running',
      );
      return;
    }

    this.isRunning = true;

    try {
      await this.recoverExpiredLocks();

      const now = new Date();
      const messages = await this.prisma.outboundMessage.findMany({
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
        take: MessageWorkerService.BATCH_SIZE,
        select: {
          id: true,
          companyId: true,
        },
      });

      for (const message of messages) {
        try {
          await this.acquireAndProcess(message.id, message.companyId);
        } catch {
          this.logger.error(
            `Failed to process outbound message ${message.id} for company ${message.companyId}`,
          );
        }
      }
    } catch {
      this.logger.error('Message worker execution failed');
    } finally {
      this.isRunning = false;
    }
  }

  private async recoverExpiredLocks(): Promise<void> {
    const now = new Date();
    const expiredAt = new Date(
      now.getTime() - MessageWorkerService.LOCK_TIMEOUT_MS,
    );
    let candidates: Array<{ id: string; companyId: string }>;

    try {
      candidates = await this.prisma.outboundMessage.findMany({
        where: {
          status: OutboundMessageStatus.PROCESSING,
          lockedAt: {
            not: null,
            lte: expiredAt,
          },
        },
        take: MessageWorkerService.EXPIRED_LOCK_BATCH_SIZE,
        select: {
          id: true,
          companyId: true,
        },
      });
    } catch {
      this.logger.error('Failed to find expired message locks');
      return;
    }

    let recoveredCount = 0;

    for (const candidate of candidates) {
      try {
        const recovery = await this.prisma.outboundMessage.updateMany({
          where: {
            id: candidate.id,
            companyId: candidate.companyId,
            status: OutboundMessageStatus.PROCESSING,
            lockedAt: {
              lte: expiredAt,
            },
          },
          data: {
            status: OutboundMessageStatus.PENDING,
            processingAt: null,
            lockedAt: null,
            lockedBy: null,
            availableAt: now,
            lastError: MessageWorkerService.LOCK_EXPIRED_ERROR,
            lastErrorCode: MessageWorkerService.LOCK_EXPIRED_ERROR_CODE,
          },
        });

        recoveredCount += recovery.count;
      } catch {
        this.logger.error(
          `Failed to recover expired lock for outbound message ${candidate.id} for company ${candidate.companyId}`,
        );
      }
    }

    if (recoveredCount > 0) {
      this.logger.log(
        `Recovered ${recoveredCount} expired outbound message lock(s)`,
      );
    }
  }

  private async acquireAndProcess(
    id: string,
    companyId: string,
  ): Promise<void> {
    const acquiredAt = new Date();
    const acquisition = await this.prisma.outboundMessage.updateMany({
      where: {
        id,
        companyId,
        status: OutboundMessageStatus.PENDING,
        lockedAt: null,
        availableAt: {
          lte: acquiredAt,
        },
      },
      data: {
        status: OutboundMessageStatus.PROCESSING,
        processingAt: acquiredAt,
        lockedAt: acquiredAt,
        lockedBy: this.workerId,
        attempts: {
          increment: 1,
        },
      },
    });

    if (acquisition.count !== 1) {
      return;
    }

    try {
      const message = await this.prisma.outboundMessage.findFirst({
        where: {
          id,
          companyId,
          status: OutboundMessageStatus.PROCESSING,
          lockedBy: this.workerId,
        },
      });

      if (!message) {
        await this.releaseAfterProcessingError(
          id,
          companyId,
          MessageWorkerService.MESSAGE_LOAD_ERROR,
        );
        this.logger.warn(
          `Acquired outbound message ${id} could not be loaded for processing`,
        );
        return;
      }

      await this.processMessage(message);
    } catch (error) {
      await this.releaseAfterProcessingError(
        id,
        companyId,
        MessageWorkerService.WORKER_PROCESSING_ERROR,
      );
      throw error;
    }
  }

  private async releaseAfterProcessingError(
    id: string,
    companyId: string,
    lastError: string,
  ): Promise<void> {
    const availableAt = new Date(Date.now() + 60_000);

    try {
      await this.prisma.outboundMessage.updateMany({
        where: {
          id,
          companyId,
          status: OutboundMessageStatus.PROCESSING,
          lockedBy: this.workerId,
        },
        data: {
          status: OutboundMessageStatus.PENDING,
          processingAt: null,
          lockedAt: null,
          lockedBy: null,
          availableAt,
          lastError,
          lastErrorCode: MessageWorkerService.WORKER_PROCESSING_ERROR_CODE,
        },
      });
    } catch {
      this.logger.error(
        `Failed to release outbound message ${id} for company ${companyId} after a processing error`,
      );
    }
  }

  private async processMessage(message: OutboundMessage): Promise<void> {
    let result: SendMessageResult;

    try {
      result = await this.messageProvider.sendText({
        companyId: message.companyId,
        recipientPhone: message.recipientPhone,
        content: message.content,
        idempotencyKey: message.idempotencyKey,
      });
    } catch (error) {
      const providerError = this.normalizeProviderError(error);
      await this.handleProviderError(message, providerError);
      return;
    }

    await this.markAsSent(message, result);
  }

  private async markAsSent(
    message: OutboundMessage,
    result: SendMessageResult,
  ): Promise<void> {
    const now = new Date();

    await this.prisma.$transaction(async (transaction) => {
      const update = await transaction.outboundMessage.updateMany({
        where: {
          id: message.id,
          companyId: message.companyId,
          status: OutboundMessageStatus.PROCESSING,
          lockedBy: this.workerId,
        },
        data: {
          status: OutboundMessageStatus.SENT,
          sentAt: now,
          failedAt: null,
          provider: result.provider,
          providerMessageId: result.providerMessageId,
          processingAt: null,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          lastErrorCode: null,
        },
      });

      if (update.count !== 1) {
        return;
      }

      await transaction.messageLog.create({
        data: {
          companyId: message.companyId,
          customerId: message.customerId,
          automationId: message.automationId,
          outboundMessageId: message.id,
          status: LogStatus.SENT,
          scheduledDate: message.scheduledAt,
          sentAt: now,
        },
      });
    });
  }

  private async handleProviderError(
    message: OutboundMessage,
    error: { message: string; code: string; retryable: boolean },
  ): Promise<void> {
    if (error.retryable && message.attempts < message.maxAttempts) {
      await this.releaseForRetry(message, error);
      return;
    }

    await this.markAsFailed(message, error);
  }

  private async releaseForRetry(
    message: OutboundMessage,
    error: { message: string; code: string },
  ): Promise<void> {
    const now = new Date();

    await this.prisma.outboundMessage.updateMany({
      where: {
        id: message.id,
        companyId: message.companyId,
        status: OutboundMessageStatus.PROCESSING,
        lockedBy: this.workerId,
      },
      data: {
        status: OutboundMessageStatus.PENDING,
        processingAt: null,
        lockedAt: null,
        lockedBy: null,
        lastError: error.message,
        lastErrorCode: error.code,
        availableAt: new Date(
          now.getTime() + this.getBackoffMs(message.attempts),
        ),
      },
    });
  }

  private async markAsFailed(
    message: OutboundMessage,
    error: { message: string; code: string },
  ): Promise<void> {
    const now = new Date();

    await this.prisma.$transaction(async (transaction) => {
      const update = await transaction.outboundMessage.updateMany({
        where: {
          id: message.id,
          companyId: message.companyId,
          status: OutboundMessageStatus.PROCESSING,
          lockedBy: this.workerId,
        },
        data: {
          status: OutboundMessageStatus.FAILED,
          failedAt: now,
          sentAt: null,
          processingAt: null,
          lockedAt: null,
          lockedBy: null,
          lastError: error.message,
          lastErrorCode: error.code,
        },
      });

      if (update.count !== 1) {
        return;
      }

      await transaction.messageLog.create({
        data: {
          companyId: message.companyId,
          customerId: message.customerId,
          automationId: message.automationId,
          outboundMessageId: message.id,
          status: LogStatus.FAILED,
          scheduledDate: message.scheduledAt,
          errorMessage: error.message,
        },
      });
    });
  }

  private normalizeProviderError(error: unknown): {
    message: string;
    code: string;
    retryable: boolean;
  } {
    if (error instanceof MessageProviderError) {
      return {
        message: error.message,
        code: error.code,
        retryable: error.retryable,
      };
    }

    return {
      message: MessageWorkerService.UNEXPECTED_PROVIDER_ERROR,
      code: MessageWorkerService.UNEXPECTED_PROVIDER_ERROR_CODE,
      retryable: true,
    };
  }

  private getBackoffMs(attempts: number): number {
    if (attempts === 1) {
      return 60_000;
    }

    if (attempts === 2) {
      return 5 * 60_000;
    }

    return 15 * 60_000;
  }
}
