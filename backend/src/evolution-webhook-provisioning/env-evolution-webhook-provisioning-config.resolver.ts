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
