import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerEligibilityService } from './customer-eligibility.service';
import { CustomerConsentService } from './customer-consent.service';

@Module({
  controllers: [CustomerController], // 👈 ESSENCIAL
  providers: [
    CustomerService,
    CustomerConsentService,
    CustomerEligibilityService,
    PrismaService,
  ],
  exports: [CustomerEligibilityService],
})
export class CustomerModule {}
