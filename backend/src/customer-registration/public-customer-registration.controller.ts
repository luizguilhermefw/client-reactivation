import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard, minutes, seconds } from '@nestjs/throttler';
import { PublicCustomerRegistrationDto } from './dto/public-customer-registration.dto';
import { PublicCustomerRegistrationService } from './public-customer-registration.service';

@Controller('public/customer-registration')
@UseGuards(ThrottlerGuard)
export class PublicCustomerRegistrationController {
  constructor(private readonly service: PublicCustomerRegistrationService) {}

  @Get(':publicId')
  @Throttle({ default: { limit: 30, ttl: seconds(60) } })
  getBootstrap(@Param('publicId') publicId: string) {
    return this.service.getBootstrap(publicId);
  }

  @Post(':publicId')
  @Throttle({ default: { limit: 5, ttl: minutes(10) } })
  submit(
    @Param('publicId') publicId: string,
    @Body() dto: PublicCustomerRegistrationDto,
  ) {
    return this.service.submit(publicId, dto);
  }
}
