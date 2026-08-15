import { Module } from '@nestjs/common';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { MessageProviderModule } from '../message-provider/message-provider.module';
import { EnvEvolutionWebhookProvisioningConfigResolver } from './env-evolution-webhook-provisioning-config.resolver';
import { EvolutionWebhookProvisioningController } from './evolution-webhook-provisioning.controller';
import { EVOLUTION_WEBHOOK_PROVISIONING_CONFIG_RESOLVER } from './evolution-webhook-provisioning-config.token';
import { EvolutionWebhookProvisioningService } from './evolution-webhook-provisioning.service';

@Module({
  imports: [MessageProviderModule],
  controllers: [EvolutionWebhookProvisioningController],
  providers: [
    ExactRolesGuard,
    EnvEvolutionWebhookProvisioningConfigResolver,
    {
      provide: EVOLUTION_WEBHOOK_PROVISIONING_CONFIG_RESOLVER,
      useExisting: EnvEvolutionWebhookProvisioningConfigResolver,
    },
    EvolutionWebhookProvisioningService,
  ],
})
export class EvolutionWebhookProvisioningModule {}
