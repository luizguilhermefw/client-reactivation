import { Injectable } from '@nestjs/common';
import { MessageProviderError } from '../contracts/message-provider.types';
import {
  EvolutionConfigResolver,
  EvolutionProviderConfig,
} from './evolution-config-resolver.interface';

@Injectable()
export class EnvEvolutionConfigResolver implements EvolutionConfigResolver {
  private static readonly DEFAULT_TIMEOUT_MS = 10_000;

  resolve(companyId: string): EvolutionProviderConfig {
    if (!companyId?.trim()) {
      throw new MessageProviderError('companyId is required', {
        code: 'INVALID_MESSAGE_INPUT',
        retryable: false,
      });
    }

    const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
    const apiKey = process.env.EVOLUTION_API_KEY?.trim();
    const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim();

    if (!apiUrl || !apiKey || !instanceName) {
      throw new MessageProviderError(
        'Message provider configuration is incomplete',
        {
          code: 'PROVIDER_CONFIGURATION_ERROR',
          retryable: false,
        },
      );
    }

    const configuredTimeout = Number(process.env.EVOLUTION_REQUEST_TIMEOUT_MS);
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : EnvEvolutionConfigResolver.DEFAULT_TIMEOUT_MS;

    return {
      apiUrl,
      apiKey,
      instanceName,
      timeoutMs,
    };
  }
}
