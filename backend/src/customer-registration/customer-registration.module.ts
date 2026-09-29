import { Module } from '@nestjs/common';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { CustomerRegistrationLinkController } from './customer-registration-link.controller';
import { CustomerRegistrationLinkService } from './customer-registration-link.service';
import { CustomerRegistrationPublicIdGenerator } from './customer-registration-public-id.generator';
import { PublicCustomerRegistrationController } from './public-customer-registration.controller';
import { PublicCustomerRegistrationService } from './public-customer-registration.service';

@Module({
  controllers: [
    CustomerRegistrationLinkController,
    PublicCustomerRegistrationController,
  ],
  providers: [
    CustomerRegistrationLinkService,
    PublicCustomerRegistrationService,
    CustomerRegistrationPublicIdGenerator,
    ExactRolesGuard,
  ],
})
export class CustomerRegistrationModule {}
