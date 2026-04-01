import { Module } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AutomationController } from './automation.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { EngineService } from './engine/engine.service';

@Module({
  controllers: [AutomationController],
  providers: [AutomationService, PrismaService, EngineService],
})
export class AutomationModule {}