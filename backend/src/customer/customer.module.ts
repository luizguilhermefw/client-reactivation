import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerEligibilityService } from './customer-eligibility.service';

@Module({
  controllers: [CustomerController], // 👈 ESSENCIAL
  providers: [CustomerService, CustomerEligibilityService, PrismaService],
  exports: [CustomerEligibilityService],
})
export class CustomerModule {}
