import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { CustomerInterestOptionService } from './customer-interest-option.service';
import { CustomerInterestController } from './customer-interest.controller';

@Module({
  controllers: [CustomerInterestController],
  providers: [CustomerInterestOptionService, ExactRolesGuard, PrismaService],
})
export class CustomerInterestModule {}
