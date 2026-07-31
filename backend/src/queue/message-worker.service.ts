import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboundMessage, OutboundMessageStatus } from '@prisma/client';
import { hostname } from 'node:os';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MessageWorkerService {
  private static readonly BATCH_SIZE = 10;
  private static readonly PROVIDER_ERROR = 'Message provider is not configured';
  private static readonly PROVIDER_ERROR_CODE = 'PROVIDER_NOT_CONFIGURED';
  private static readonly MESSAGE_LOAD_ERROR =
    'Acquired message could not be loaded';
  private static readonly WORKER_PROCESSING_ERROR =
    'Message processing failed after acquisition';
  private static readonly WORKER_PROCESSING_ERROR_CODE =
    'WORKER_PROCESSING_ERROR';

  private readonly logger = new Logger(MessageWorkerService.name);
  private readonly workerId = `${hostname()}:${process.pid}`;
  private isRunning = false;

  constructor(private readonly prisma: PrismaService) {}

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
        } catch (error) {
          const stack = error instanceof Error ? error.stack : undefined;
          this.logger.error(
            `Failed to process outbound message ${message.id}`,
            stack,
          );
        }
      }
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error('Message worker execution failed', stack);
    } finally {
      this.isRunning = false;
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

      await this.releaseWithoutProvider(message);
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
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to release outbound message ${id} after a processing error`,
        stack,
      );
    }
  }

  private async releaseWithoutProvider(
    message: OutboundMessage,
  ): Promise<void> {
    const now = new Date();

    if (message.attempts >= message.maxAttempts) {
      await this.prisma.outboundMessage.updateMany({
        where: {
          id: message.id,
          companyId: message.companyId,
          status: OutboundMessageStatus.PROCESSING,
          lockedBy: this.workerId,
        },
        data: {
          status: OutboundMessageStatus.FAILED,
          failedAt: now,
          lockedAt: null,
          lockedBy: null,
          lastError: MessageWorkerService.PROVIDER_ERROR,
          lastErrorCode: MessageWorkerService.PROVIDER_ERROR_CODE,
        },
      });

      this.logger.warn(
        `Outbound message ${message.id} reached the maximum number of attempts`,
      );
      return;
    }

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
        lastError: MessageWorkerService.PROVIDER_ERROR,
        lastErrorCode: MessageWorkerService.PROVIDER_ERROR_CODE,
        availableAt: new Date(
          now.getTime() + this.getBackoffMs(message.attempts),
        ),
      },
    });
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
