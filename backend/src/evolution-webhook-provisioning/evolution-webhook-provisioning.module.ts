import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { EnvEvolutionWebhookProvisioningConfigResolver } from './env-evolution-webhook-provisioning-config.resolver';
import { EvolutionWebhookProvisioningController } from './evolution-webhook-provisioning.controller';
import { EVOLUTION_WEBHOOK_PROVISIONING_CONFIG_RESOLVER } from './evolution-webhook-provisioning-config.token';
import { EvolutionWebhookProvisioningService } from './evolution-webhook-provisioning.service';

@Module({
  imports: [PrismaModule],
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
  exports: [EvolutionWebhookProvisioningService],
})
export class EvolutionWebhookProvisioningModule {}
