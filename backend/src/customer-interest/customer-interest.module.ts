import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { CustomerInterestOptionService } from './customer-interest-option.service';
import { CustomerInterestController } from './customer-interest.controller';
import { CustomerInterestAssignmentController } from './customer-interest-assignment.controller';
import { CustomerInterestAssignmentService } from './customer-interest-assignment.service';

@Module({
  controllers: [
    CustomerInterestController,
    CustomerInterestAssignmentController,
  ],
  providers: [
    CustomerInterestOptionService,
    CustomerInterestAssignmentService,
    ExactRolesGuard,
    PrismaService,
  ],
})
export class CustomerInterestModule {}
