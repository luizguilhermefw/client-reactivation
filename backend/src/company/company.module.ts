import { Module } from '@nestjs/common';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';
import { CompanyMessagingPolicyService } from './company-messaging-policy.service';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';

@Module({
  controllers: [CompanyController],
  providers: [CompanyMessagingPolicyService, CompanyService, ExactRolesGuard],
})
export class CompanyModule {}
