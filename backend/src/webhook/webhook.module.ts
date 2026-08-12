import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomerModule } from '../customer/customer.module';
import { ConfiguredEvolutionInstanceTenantResolver } from './configured-evolution-instance-tenant.resolver';
import { EVOLUTION_INSTANCE_TENANT_RESOLVER } from './evolution-instance-tenant-resolver.interface';
import { EvolutionWebhookController } from './evolution-webhook.controller';
import { EvolutionWebhookSecretGuard } from './evolution-webhook-secret.guard';
import { EvolutionWebhookService } from './evolution-webhook.service';
import { InboundOptOutService } from './inbound-opt-out.service';

@Module({
  imports: [CustomerModule, PrismaModule],
  controllers: [EvolutionWebhookController],
  providers: [
    ConfiguredEvolutionInstanceTenantResolver,
    {
      provide: EVOLUTION_INSTANCE_TENANT_RESOLVER,
      useExisting: ConfiguredEvolutionInstanceTenantResolver,
    },
    EvolutionWebhookSecretGuard,
    EvolutionWebhookService,
    InboundOptOutService,
  ],
})
export class WebhookModule {}
