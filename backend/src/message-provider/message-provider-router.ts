import { Injectable } from '@nestjs/common';
import { MessagingChannelStatus, MessagingProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { MessageProvider } from './contracts/message-provider.interface';
import {
  MessageProviderError,
  SendImageMessageInput,
  SendMessageResult,
  SendTemplateMessageInput,
  SendTextMessageInput,
} from './contracts/message-provider.types';
import { EvolutionMessageProvider } from './evolution/evolution-message.provider';
import { MetaCloudMessageProvider } from './meta-cloud/meta-cloud-message.provider';

@Injectable()
export class MessageProviderRouter implements MessageProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionMessageProvider,
    private readonly metaCloud: MetaCloudMessageProvider,
  ) {}

  async sendText(input: SendTextMessageInput): Promise<SendMessageResult> {
    const provider = await this.resolve(
      input?.companyId,
      input?.messagingChannelId,
    );
    return provider.sendText(input);
  }

  async sendImage(input: SendImageMessageInput): Promise<SendMessageResult> {
    const provider = await this.resolve(
      input?.companyId,
      input?.messagingChannelId,
    );
    return provider.sendImage(input);
  }

  async sendTemplate(
    input: SendTemplateMessageInput,
  ): Promise<SendMessageResult> {
    const provider = await this.resolve(
      input?.companyId,
      input?.messagingChannelId,
    );
    return provider.sendTemplate(input);
  }

  private async resolve(
    companyId: string,
    messagingChannelId: string,
  ): Promise<MessageProvider> {
    if (
      typeof companyId !== 'string' ||
      !companyId.trim() ||
      typeof messagingChannelId !== 'string' ||
      !messagingChannelId.trim()
    ) {
      throw new MessageProviderError('Messaging channel context is required', {
        code: 'INVALID_MESSAGE_INPUT',
        retryable: false,
      });
    }

    let channel: { provider: MessagingProvider } | null;
    try {
      channel = await this.prisma.messagingChannel.findFirst({
        where: {
          id: messagingChannelId.trim(),
          companyId: companyId.trim(),
          status: MessagingChannelStatus.ACTIVE,
        },
        select: { provider: true },
      });
    } catch {
      throw new MessageProviderError(
        'Message provider channel resolution is temporarily unavailable',
        {
          code: 'PROVIDER_UNAVAILABLE',
          retryable: true,
        },
      );
    }

    switch (channel?.provider) {
      case MessagingProvider.EVOLUTION:
        return this.evolution;
      case MessagingProvider.META_CLOUD:
        return this.metaCloud;
      default:
        throw new MessageProviderError(
          'Message provider configuration is incomplete',
          {
            code: 'PROVIDER_CONFIGURATION_ERROR',
            retryable: false,
          },
        );
    }
  }
}
