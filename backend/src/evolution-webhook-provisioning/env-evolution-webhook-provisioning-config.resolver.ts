import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type {
  EvolutionConfigResolver,
  EvolutionProviderConfig,
} from '../message-provider/evolution/evolution-config-resolver.interface';
import { EVOLUTION_CONFIG_RESOLVER } from '../message-provider/evolution/evolution-config-resolver.token';
import type {
  EvolutionWebhookProvisioningConfig,
  EvolutionWebhookProvisioningConfigResolver,
} from './evolution-webhook-provisioning-config.interface';

@Injectable()
export class EnvEvolutionWebhookProvisioningConfigResolver implements EvolutionWebhookProvisioningConfigResolver {
  private static readonly DEFAULT_TIMEOUT_MS = 10_000;

  constructor(
    @Inject(EVOLUTION_CONFIG_RESOLVER)
    private readonly evolutionConfigResolver: EvolutionConfigResolver,
  ) {}

  async resolve(
    companyId: string,
  ): Promise<EvolutionWebhookProvisioningConfig> {
    let providerConfig: EvolutionProviderConfig;

    try {
      providerConfig = await this.evolutionConfigResolver.resolve(companyId);
    } catch {
      throw this.configurationError();
    }

    return this.withWebhookConfig(providerConfig);
  }

  async resolveForInstance(
    companyId: string,
    instanceName: string,
  ): Promise<EvolutionWebhookProvisioningConfig> {
    if (!companyId?.trim() || !instanceName?.trim()) {
      throw this.configurationError();
    }

    const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
    const apiKey = process.env.EVOLUTION_API_KEY?.trim();
    const configuredTimeout = Number(process.env.EVOLUTION_REQUEST_TIMEOUT_MS);
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : EnvEvolutionWebhookProvisioningConfigResolver.DEFAULT_TIMEOUT_MS;

    if (!apiUrl || !apiKey) {
      throw this.configurationError();
    }

    return this.withWebhookConfig({
      apiUrl,
      apiKey,
      instanceName: instanceName.trim(),
      timeoutMs,
    });
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
