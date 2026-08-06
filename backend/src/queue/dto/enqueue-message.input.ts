import { OutboundMessageSource, Prisma } from '@prisma/client';

/**
 * Conservative 5 MiB limit for declared file-size metadata in the image-message
 * MVP. This does not verify the remote resource; upload/storage must validate
 * the real size. Review this value before production rollout.
 */
export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Conservative caption limit for the image-message MVP. Review this value
 * before production rollout against provider and product constraints.
 */
export const MAX_IMAGE_CAPTION_LENGTH = 1_024;

export type ImageMimeType = 'image/jpeg' | 'image/png';

export interface ImageMessagePayload {
  mediaUrl: string;
  mimeType: ImageMimeType;
  fileName: string;
  /** Declared metadata only; upload/storage must verify the real file size. */
  fileSize: number;
  caption?: string;
}

interface EnqueueMessageBaseInput {
  companyId: string;

  customerId?: string;
  automationId?: string;

  source: OutboundMessageSource;

  recipientPhone: string;

  scheduledAt?: Date;

  priority?: number;
  maxAttempts?: number;

  idempotencyKey: string;
}

export interface EnqueueTextMessageInput extends EnqueueMessageBaseInput {
  type?: 'TEXT';
  content: string;
  payload?: Prisma.InputJsonValue;
}

export interface EnqueueImageMessageInput extends EnqueueMessageBaseInput {
  type: 'IMAGE';
  content?: never;
  payload: ImageMessagePayload;
}

export type EnqueueMessageInput =
  | EnqueueTextMessageInput
  | EnqueueImageMessageInput;
