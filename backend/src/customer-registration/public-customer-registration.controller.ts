import { Controller, Get, Param } from '@nestjs/common';
import { PublicCustomerRegistrationService } from './public-customer-registration.service';

@Controller('public/customer-registration')
export class PublicCustomerRegistrationController {
  constructor(private readonly service: PublicCustomerRegistrationService) {}

  @Get(':publicId')
  getBootstrap(@Param('publicId') publicId: string) {
    return this.service.getBootstrap(publicId);
  }
}
