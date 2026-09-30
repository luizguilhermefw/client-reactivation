import { Module } from '@nestjs/common';
import { ThrottlerModule, minutes } from '@nestjs/throttler';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { CustomerModule } from '../customer/customer.module';
import { CustomerRegistrationLinkController } from './customer-registration-link.controller';
import { CustomerRegistrationLinkService } from './customer-registration-link.service';
import { CustomerRegistrationPublicIdGenerator } from './customer-registration-public-id.generator';
import { PublicCustomerRegistrationController } from './public-customer-registration.controller';
import { PublicCustomerRegistrationService } from './public-customer-registration.service';

@Module({
  imports: [
    CustomerModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: minutes(10),
        limit: 5,
      },
    ]),
  ],
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
