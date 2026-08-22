import { Module } from '@nestjs/common';
import { AdminEntitlementController } from './admin-entitlement.controller';
import { CompanyEntitlementController } from './company-entitlement.controller';
import { EntitlementService } from './entitlement.service';

@Module({
  controllers: [AdminEntitlementController, CompanyEntitlementController],
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementModule {}
