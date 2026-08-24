import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { MessagingChannelStatus, MessagingProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { EvolutionProviderConfig } from '../message-provider/evolution/evolution-config-resolver.interface';
import type {
  EvolutionWebhookProvisioningConfig,
  EvolutionWebhookProvisioningConfigResolver,
} from './evolution-webhook-provisioning-config.interface';

@Injectable()
export class EnvEvolutionWebhookProvisioningConfigResolver implements EvolutionWebhookProvisioningConfigResolver {
  private static readonly DEFAULT_TIMEOUT_MS = 10_000;

  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    companyId: string,
  ): Promise<EvolutionWebhookProvisioningConfig> {
    if (!companyId?.trim()) {
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
        select: { instanceName: true },
      });
    } catch {
      throw this.configurationError();
    }

    if (channels.length !== 1 || !channels[0].instanceName.trim()) {
      throw this.configurationError();
    }

    const providerConfig = this.sharedProviderConfig(
      channels[0].instanceName,
    );

    return this.withWebhookConfig(providerConfig);
  }

  async resolveForInstance(
    companyId: string,
    instanceName: string,
  ): Promise<EvolutionWebhookProvisioningConfig> {
    if (!companyId?.trim() || !instanceName?.trim()) {
      throw this.configurationError();
    }

    return this.withWebhookConfig(this.sharedProviderConfig(instanceName));
  }

  private sharedProviderConfig(instanceName: string): EvolutionProviderConfig {
    const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
    const apiKey = process.env.EVOLUTION_API_KEY?.trim();
    const configuredTimeout = Number(process.env.EVOLUTION_REQUEST_TIMEOUT_MS);
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : EnvEvolutionWebhookProvisioningConfigResolver.DEFAULT_TIMEOUT_MS;

    if (!apiUrl || !apiKey || !instanceName.trim()) {
      throw this.configurationError();
    }

    return { apiUrl, apiKey, instanceName: instanceName.trim(), timeoutMs };
  }

  private withWebhookConfig(
    providerConfig: EvolutionProviderConfig,
  ): EvolutionWebhookProvisioningConfig {
    const publicUrl = process.env.EVOLUTION_WEBHOOK_PUBLIC_URL?.trim();
    const secret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();

    if (!publicUrl || !secret || !this.isSupportedPublicUrl(publicUrl)) {
      throw this.configurationError();
    }

    return {
      ...providerConfig,
      publicUrl,
      secret,
    };
  }

  private isSupportedPublicUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        Boolean(parsed.hostname) &&
        !parsed.username &&
        !parsed.password
      );
    } catch {
      return false;
    }
  }

  private configurationError(): InternalServerErrorException {
    return new InternalServerErrorException(
      'Evolution webhook configuration is incomplete',
    );
  }
}
