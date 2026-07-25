import { OutboundMessageSource, Prisma } from '@prisma/client';

export interface EnqueueMessageInput {
  companyId: string;

  customerId?: string;
  automationId?: string;

  source: OutboundMessageSource;

  recipientPhone: string;
  content: string;
  payload?: Prisma.InputJsonValue;

  scheduledAt?: Date;

  priority?: number;
  maxAttempts?: number;

  idempotencyKey: string;
}