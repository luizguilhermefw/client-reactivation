import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OutboundMessage,
  OutboundMessageStatus,
  OutboundMessageType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { MediaUrlPolicy } from '../message-provider/media/media-url-policy.interface';
import { MediaUrlNotAllowedError } from '../message-provider/media/media-url-policy.interface';
import { MEDIA_URL_POLICY } from '../message-provider/media/media-url-policy.token';
import {
  EnqueueMessageInput,
  ImageMessagePayload,
  MAX_IMAGE_CAPTION_LENGTH,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from './dto/enqueue-message.input';

interface PreparedMessageContent {
  type: OutboundMessageType;
  content: string;
  payload?: Prisma.InputJsonValue;
}

@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_URL_POLICY)
    private readonly mediaUrlPolicy: MediaUrlPolicy,
  ) {}

  async enqueue(input: EnqueueMessageInput): Promise<OutboundMessage> {
    const messageContent = this.validateInput(input);

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
        type: messageContent.type,
        status: OutboundMessageStatus.PENDING,

        recipientPhone: input.recipientPhone.trim(),
        content: messageContent.content,
        payload: messageContent.payload,

        scheduledAt,
        availableAt: scheduledAt,

        priority: input.priority ?? 0,
        maxAttempts: input.maxAttempts ?? 3,

        idempotencyKey: input.idempotencyKey.trim(),
      },
    });
  }

  private validateInput(input: EnqueueMessageInput): PreparedMessageContent {
    if (!input.companyId?.trim()) {
      throw new BadRequestException('companyId é obrigatório');
    }

    if (!input.recipientPhone?.trim()) {
      throw new BadRequestException('recipientPhone é obrigatório');
    }

    if (!input.idempotencyKey?.trim()) {
      throw new BadRequestException('idempotencyKey é obrigatório');
    }

    if (input.priority !== undefined && input.priority < 0) {
      throw new BadRequestException('priority não pode ser menor que zero');
    }

    if (input.maxAttempts !== undefined && input.maxAttempts < 1) {
      throw new BadRequestException('maxAttempts deve ser maior ou igual a um');
    }

    if (input.scheduledAt && Number.isNaN(input.scheduledAt.getTime())) {
      throw new BadRequestException('scheduledAt é inválido');
    }

    if (input.type === OutboundMessageType.IMAGE) {
      const payload = this.validateImagePayload(input.payload);

      return {
        type: OutboundMessageType.IMAGE,
        content: payload.caption ?? '',
        payload: payload as unknown as Prisma.InputJsonValue,
      };
    }

    if (input.type !== undefined && input.type !== OutboundMessageType.TEXT) {
      throw new BadRequestException('type de mensagem é inválido');
    }

    if (!input.content?.trim()) {
      throw new BadRequestException('content é obrigatório');
    }

    return {
      type: OutboundMessageType.TEXT,
      content: input.content,
      payload: input.payload,
    };
  }

  private validateImagePayload(payload: unknown): ImageMessagePayload {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('payload de imagem é obrigatório');
    }

    const value = payload as Record<string, unknown>;

    for (const internalField of ['companyId', 'idempotencyKey']) {
      if (Object.prototype.hasOwnProperty.call(value, internalField)) {
        throw new BadRequestException(
          `${internalField} não pode ser incluído no payload`,
        );
      }
    }

    const allowedFields = new Set([
      'mediaUrl',
      'mimeType',
      'fileName',
      'fileSize',
      'caption',
    ]);
    const unexpectedField = Object.keys(value).find(
      (field) => !allowedFields.has(field),
    );

    if (unexpectedField) {
      throw new BadRequestException(
        `${unexpectedField} não é permitido no payload de imagem`,
      );
    }

    if (typeof value.mediaUrl !== 'string' || !value.mediaUrl.trim()) {
      throw new BadRequestException('mediaUrl é obrigatória');
    }

    const mediaUrl = value.mediaUrl.trim();

    try {
      this.mediaUrlPolicy.assertAllowed(mediaUrl);
    } catch (error) {
      if (error instanceof MediaUrlNotAllowedError) {
        throw new BadRequestException('Media URL is not allowed');
      }

      throw error;
    }

    if (value.mimeType !== 'image/jpeg' && value.mimeType !== 'image/png') {
      throw new BadRequestException(
        'mimeType deve ser image/jpeg ou image/png',
      );
    }

    if (typeof value.fileName !== 'string' || !value.fileName.trim()) {
      throw new BadRequestException('fileName é obrigatório');
    }

    if (
      typeof value.fileSize !== 'number' ||
      !Number.isInteger(value.fileSize) ||
      value.fileSize <= 0
    ) {
      throw new BadRequestException('fileSize deve ser um inteiro positivo');
    }

    if (value.fileSize > MAX_IMAGE_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `fileSize não pode exceder ${MAX_IMAGE_FILE_SIZE_BYTES} bytes`,
      );
    }

    if (value.caption !== undefined && typeof value.caption !== 'string') {
      throw new BadRequestException('caption deve ser uma string');
    }

    if (
      typeof value.caption === 'string' &&
      value.caption.length > MAX_IMAGE_CAPTION_LENGTH
    ) {
      throw new BadRequestException(
        `caption não pode exceder ${MAX_IMAGE_CAPTION_LENGTH} caracteres`,
      );
    }

    return {
      mediaUrl,
      mimeType: value.mimeType,
      fileName: value.fileName.trim(),
      fileSize: value.fileSize,
      ...(value.caption === undefined ? {} : { caption: value.caption }),
    };
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
        throw new NotFoundException('Cliente não encontrado para esta empresa');
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
