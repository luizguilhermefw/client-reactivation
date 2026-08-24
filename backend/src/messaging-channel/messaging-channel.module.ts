import { Module } from '@nestjs/common';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { EvolutionWebhookProvisioningModule } from '../evolution-webhook-provisioning/evolution-webhook-provisioning.module';
import { EnvEvolutionInstanceProvisioningClient } from './env-evolution-instance-provisioning.client';
import { EVOLUTION_INSTANCE_PROVISIONING_CLIENT } from './evolution-instance-provisioning-client.token';
import { MessagingChannelController } from './messaging-channel.controller';
import { MessagingChannelProvisioningService } from './messaging-channel-provisioning.service';
import { MessagingChannelRoutingService } from './messaging-channel-routing.service';

@Module({
  imports: [EntitlementModule, EvolutionWebhookProvisioningModule],
  controllers: [MessagingChannelController],
  providers: [
    ExactRolesGuard,
    EnvEvolutionInstanceProvisioningClient,
    {
      provide: EVOLUTION_INSTANCE_PROVISIONING_CLIENT,
      useExisting: EnvEvolutionInstanceProvisioningClient,
    },
    MessagingChannelProvisioningService,
    MessagingChannelRoutingService,
  ],
  exports: [MessagingChannelRoutingService],
})
export class MessagingChannelModule {}
