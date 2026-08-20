import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DatabaseEvolutionConfigResolver } from './evolution/database-evolution-config.resolver';
import { EVOLUTION_CONFIG_RESOLVER } from './evolution/evolution-config-resolver.token';
import { EvolutionMessageProvider } from './evolution/evolution-message.provider';
import { EnvMediaUrlPolicy } from './media/env-media-url-policy';
import { MEDIA_URL_POLICY } from './media/media-url-policy.token';
import { MESSAGE_PROVIDER } from './message-provider.token';

@Module({
  imports: [PrismaModule],
  providers: [
    DatabaseEvolutionConfigResolver,
    {
      provide: EVOLUTION_CONFIG_RESOLVER,
      useExisting: DatabaseEvolutionConfigResolver,
    },
    EnvMediaUrlPolicy,
    {
      provide: MEDIA_URL_POLICY,
      useExisting: EnvMediaUrlPolicy,
    },
    EvolutionMessageProvider,
    {
      provide: MESSAGE_PROVIDER,
      useExisting: EvolutionMessageProvider,
    },
  ],
  exports: [MESSAGE_PROVIDER, MEDIA_URL_POLICY, EVOLUTION_CONFIG_RESOLVER],
})
export class MessageProviderModule {}
