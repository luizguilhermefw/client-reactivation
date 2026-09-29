import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicCustomerRegistrationDto } from './dto/public-customer-registration.dto';
import { PublicCustomerRegistrationService } from './public-customer-registration.service';

@Controller('public/customer-registration')
export class PublicCustomerRegistrationController {
  constructor(private readonly service: PublicCustomerRegistrationService) {}

  @Get(':publicId')
  getBootstrap(@Param('publicId') publicId: string) {
    return this.service.getBootstrap(publicId);
  }

  @Post(':publicId')
  submit(
    @Param('publicId') publicId: string,
    @Body() dto: PublicCustomerRegistrationDto,
  ) {
    return this.service.submit(publicId, dto);
  }
}
