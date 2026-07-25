import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OutboundMessage, OutboundMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EnqueueMessageInput } from './dto/enqueue-message.input';

@Injectable()
export class QueueService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: EnqueueMessageInput): Promise<OutboundMessage> {
    this.validateInput(input);

    await this.validateTenantRelations(input);

    const scheduledAt = input.scheduledAt ?? new Date();

    return this.prisma.outboundMessage.upsert({
      where: {
        companyId_idempotencyKey: {
          companyId: input.companyId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      update: {},
      create: {
        companyId: input.companyId,
        customerId: input.customerId,
        automationId: input.automationId,

        source: input.source,
        status: OutboundMessageStatus.PENDING,

        recipientPhone: input.recipientPhone.trim(),
        content: input.content,
        payload: input.payload,

        scheduledAt,
        availableAt: scheduledAt,

        priority: input.priority ?? 0,
        maxAttempts: input.maxAttempts ?? 3,

        idempotencyKey: input.idempotencyKey.trim(),
      },
    });
  }

  private validateInput(input: EnqueueMessageInput): void {
    if (!input.companyId?.trim()) {
      throw new BadRequestException('companyId é obrigatório');
    }

    if (!input.recipientPhone?.trim()) {
      throw new BadRequestException('recipientPhone é obrigatório');
    }

    if (!input.content?.trim()) {
      throw new BadRequestException('content é obrigatório');
    }

    if (!input.idempotencyKey?.trim()) {
      throw new BadRequestException('idempotencyKey é obrigatório');
    }

    if (input.priority !== undefined && input.priority < 0) {
      throw new BadRequestException(
        'priority não pode ser menor que zero',
      );
    }

    if (input.maxAttempts !== undefined && input.maxAttempts < 1) {
      throw new BadRequestException(
        'maxAttempts deve ser maior ou igual a um',
      );
    }

    if (
      input.scheduledAt &&
      Number.isNaN(input.scheduledAt.getTime())
    ) {
      throw new BadRequestException('scheduledAt é inválido');
    }
  }

  private async validateTenantRelations(
    input: EnqueueMessageInput,
  ): Promise<void> {
    const companyExists = await this.prisma.company.findUnique({
      where: {
        id: input.companyId,
      },
      select: {
        id: true,
      },
    });

    if (!companyExists) {
      throw new NotFoundException('Empresa não encontrada');
    }

    if (input.customerId) {
      const customerExists = await this.prisma.customer.findFirst({
        where: {
          id: input.customerId,
          companyId: input.companyId,
        },
        select: {
          id: true,
        },
      });

      if (!customerExists) {
        throw new NotFoundException(
          'Cliente não encontrado para esta empresa',
        );
      }
    }

    if (input.automationId) {
      const automationExists = await this.prisma.automation.findFirst({
        where: {
          id: input.automationId,
          companyId: input.companyId,
        },
        select: {
          id: true,
        },
      });

      if (!automationExists) {
        throw new NotFoundException(
          'Automação não encontrada para esta empresa',
        );
      }
    }
  }
}