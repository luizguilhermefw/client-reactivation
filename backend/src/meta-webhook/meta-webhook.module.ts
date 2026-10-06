import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MetaWebhookController } from './meta-webhook.controller';
import { MetaWebhookService } from './meta-webhook.service';
import { MetaWebhookSignatureGuard } from './meta-webhook-signature.guard';

@Module({
  imports: [PrismaModule],
  controllers: [MetaWebhookController],
  providers: [MetaWebhookService, MetaWebhookSignatureGuard],
})
export class MetaWebhookModule {}
