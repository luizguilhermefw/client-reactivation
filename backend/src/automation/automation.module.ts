import { Module } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AutomationController } from './automation.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { EngineService } from './engine/engine.service';
import { MessageModule } from '../message/message.module';

@Module({
  imports: [MessageModule],
  controllers: [AutomationController],
  providers: [AutomationService, PrismaService, EngineService],
})
export class AutomationModule {}