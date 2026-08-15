import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CompanyModule } from './company/company.module';
import { CustomerModule } from './customer/customer.module';
import { AutomationModule } from './automation/automation.module';
import { ScheduleModule } from '@nestjs/schedule';
import { MessageModule } from './message/message.module';
import { UsersModule } from './users/user.module';
import { AdminModule } from './admin/admin.module';
import { QueueModule } from './queue/queue.module';
import { MessageProviderModule } from './message-provider/message-provider.module';
import { MediaStorageModule } from './media-storage/media-storage.module';
import { WebhookModule } from './webhook/webhook.module';
import { EvolutionWebhookProvisioningModule } from './evolution-webhook-provisioning/evolution-webhook-provisioning.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    CompanyModule,
    CustomerModule,
    AutomationModule,
    MessageModule,
    UsersModule,
    AdminModule,
    QueueModule,
    MessageProviderModule,
    MediaStorageModule,
    WebhookModule,
    EvolutionWebhookProvisioningModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
