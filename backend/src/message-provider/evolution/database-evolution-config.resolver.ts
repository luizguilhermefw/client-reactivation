import { Injectable } from '@nestjs/common';
import { MessagingChannelStatus, MessagingProvider } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MessageProviderError } from '../contracts/message-provider.types';
import type {
  EvolutionConfigResolver,
  EvolutionProviderConfig,
} from './evolution-config-resolver.interface';

@Injectable()
export class DatabaseEvolutionConfigResolver implements EvolutionConfigResolver {
  private static readonly DEFAULT_TIMEOUT_MS = 10_000;

  constructor(private readonly prisma: PrismaService) {}

  async resolve(companyId: string): Promise<EvolutionProviderConfig> {
    if (!companyId?.trim()) {
      throw new MessageProviderError('companyId is required', {
        code: 'INVALID_MESSAGE_INPUT',
        retryable: false,
      });
    }

    const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
    const apiKey = process.env.EVOLUTION_API_KEY?.trim();

    if (!apiUrl || !apiKey) {
      throw this.configurationError();
    }

    let channels: Array<{ instanceName: string }>;
    try {
      channels = await this.prisma.messagingChannel.findMany({
        where: {
          companyId: companyId.trim(),
          provider: MessagingProvider.EVOLUTION,
          status: MessagingChannelStatus.ACTIVE,
        },
        take: 2,
        select: {
          instanceName: true,
        },
      });
    } catch {
      throw this.channelResolutionUnavailableError();
    }

    if (channels.length !== 1 || !channels[0].instanceName.trim()) {
      throw this.configurationError();
    }

    const configuredTimeout = Number(process.env.EVOLUTION_REQUEST_TIMEOUT_MS);
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DatabaseEvolutionConfigResolver.DEFAULT_TIMEOUT_MS;

    return {
      apiUrl,
      apiKey,
      instanceName: channels[0].instanceName.trim(),
      timeoutMs,
    };
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

  private channelResolutionUnavailableError(): MessageProviderError {
    return new MessageProviderError(
      'Message provider channel resolution is temporarily unavailable',
      {
        code: 'PROVIDER_UNAVAILABLE',
        retryable: true,
      },
    );
  }
}
