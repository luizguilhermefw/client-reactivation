import { Module } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AutomationController } from './automation.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { EngineService } from './engine/engine.service';
import { QueueModule } from '../queue/queue.module';
import { CustomerModule } from '../customer/customer.module';
import { MessagingChannelModule } from '../messaging-channel/messaging-channel.module';

@Module({
  imports: [CustomerModule, QueueModule, MessagingChannelModule],
  controllers: [AutomationController],
  providers: [AutomationService, PrismaService, EngineService],
})
export class AutomationModule {}
