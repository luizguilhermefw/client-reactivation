import { Injectable } from '@nestjs/common';
import { MessagingChannelStatus, MessagingProvider } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MessageProviderError } from '../contracts/message-provider.types';
import type {
  MetaCloudConfigResolver,
  MetaCloudProviderConfig,
} from './meta-cloud-config-resolver.interface';

@Injectable()
export class EnvMetaCloudConfigResolver implements MetaCloudConfigResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    companyId: string,
    messagingChannelId: string,
  ): Promise<MetaCloudProviderConfig> {
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

    // Temporary credentials are explicitly bound to one tenant and one channel.
    // Resolve lazily so missing Meta configuration never blocks Evolution startup.
    const configuredCompanyId = process.env.META_WHATSAPP_COMPANY_ID?.trim();
    const configuredChannelId =
      process.env.META_WHATSAPP_MESSAGING_CHANNEL_ID?.trim();
    const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim();
    const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();
    const graphVersion = process.env.META_WHATSAPP_GRAPH_VERSION?.trim();
    const rawTimeout = process.env.META_WHATSAPP_REQUEST_TIMEOUT_MS;
    const timeoutMs = rawTimeout === undefined ? 10_000 : Number(rawTimeout);

    if (
      companyId.trim() !== configuredCompanyId ||
      messagingChannelId.trim() !== configuredChannelId ||
      !accessToken ||
      /\s/.test(accessToken) ||
      !phoneNumberId ||
      !/^\d+$/.test(phoneNumberId) ||
      !graphVersion ||
      !/^v\d+\.\d+$/.test(graphVersion) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 120_000
    ) {
      throw this.configurationError();
    }

    let channel: { id: string } | null;
    try {
      channel = await this.prisma.messagingChannel.findFirst({
        where: {
          id: messagingChannelId.trim(),
          companyId: companyId.trim(),
          provider: MessagingProvider.META_CLOUD,
          status: MessagingChannelStatus.ACTIVE,
        },
        select: { id: true },
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
    if (!channel) throw this.configurationError();

    return { accessToken, phoneNumberId, graphVersion, timeoutMs };
  }

  private configurationError(): MessageProviderError {
    return new MessageProviderError(
      'Message provider configuration is incomplete',
      {
        code: 'PROVIDER_CONFIGURATION_ERROR',
        retryable: false,
      },
    );
  }
}
