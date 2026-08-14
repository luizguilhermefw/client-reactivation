import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerEligibilityService } from './customer-eligibility.service';
import { CustomerConsentService } from './customer-consent.service';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { CustomerImportController } from './import/customer-import.controller';
import { CustomerImportParserService } from './import/customer-import-parser.service';
import { CustomerImportService } from './import/customer-import.service';
import { CustomerImportTemplateService } from './import/customer-import-template.service';

@Module({
  controllers: [CustomerController, CustomerImportController], // 👈 ESSENCIAL
  providers: [
    CustomerService,
    CustomerConsentService,
    CustomerEligibilityService,
    CustomerImportParserService,
    CustomerImportService,
    CustomerImportTemplateService,
    ExactRolesGuard,
    PrismaService,
  ],
  exports: [CustomerConsentService, CustomerEligibilityService],
})
export class CustomerModule {}
