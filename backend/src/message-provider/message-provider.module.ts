import { Module } from '@nestjs/common';
import { EnvEvolutionConfigResolver } from './evolution/env-evolution-config.resolver';
import { EVOLUTION_CONFIG_RESOLVER } from './evolution/evolution-config-resolver.token';
import { EvolutionMessageProvider } from './evolution/evolution-message.provider';
import { MESSAGE_PROVIDER } from './message-provider.token';

@Module({
  providers: [
    EnvEvolutionConfigResolver,
    {
      provide: EVOLUTION_CONFIG_RESOLVER,
      useExisting: EnvEvolutionConfigResolver,
    },
    EvolutionMessageProvider,
    {
      provide: MESSAGE_PROVIDER,
      useExisting: EvolutionMessageProvider,
    },
  ],
  exports: [MESSAGE_PROVIDER],
})
export class MessageProviderModule {}
