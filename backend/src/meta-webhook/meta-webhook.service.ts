import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { canAdvanceDelivery } from './meta-delivery-transition';
import { parseMetaStatuses } from './meta-status-parser';

@Injectable()
export class MetaWebhookService {
  constructor(private readonly prisma: PrismaService) {}

  async handle(payload: unknown): Promise<void> {
    try {
      for (const event of parseMetaStatuses(payload)) {
        const matches = await this.prisma.outboundMessage.findMany({
          where: {
            provider: 'META_CLOUD',
            providerMessageId: event.providerMessageId,
          },
          take: 2,
          select: {
            id: true,
            companyId: true,
            deliveryStatus: true,
            sentAt: true,
          },
        });
        if (matches.length > 1)
          throw new ServiceUnavailableException(
            'Webhook message correlation is ambiguous',
          );
        const message = matches[0];
        if (
          !message ||
          !canAdvanceDelivery(message.deliveryStatus, event.status)
        )
          continue;
        const timestamp = event.timestamp ?? new Date();
        const updated = await this.prisma.outboundMessage.updateMany({
          where: {
            id: message.id,
            companyId: message.companyId,
            provider: 'META_CLOUD',
            providerMessageId: event.providerMessageId,
            deliveryStatus: message.deliveryStatus,
          },
          data: {
            deliveryStatus: event.status,
            ...(event.status === 'SENT' && !message.sentAt
              ? { sentAt: timestamp }
              : {}),
            ...(event.status === 'DELIVERED' ? { deliveredAt: timestamp } : {}),
            ...(event.status === 'READ' ? { readAt: timestamp } : {}),
            ...(event.status === 'FAILED'
              ? {
                  failedAt: timestamp,
                  lastErrorCode: event.errorCode ?? 'META_DELIVERY_FAILED',
                  lastError: 'Message delivery failed',
                }
              : {}),
          },
        });
        // A concurrent transition must be re-evaluated on provider redelivery,
        // not acknowledged silently (which could lose a READ event).
        if (updated.count !== 1)
          throw new ServiceUnavailableException(
            'Webhook status processing is temporarily unavailable',
          );
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'Webhook status processing is temporarily unavailable',
      );
    }
  }
}
