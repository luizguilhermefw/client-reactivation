import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { CustomerRegistrationLinkService } from './customer-registration-link.service';
import { CustomerRegistrationQrCodeService } from './customer-registration-qr-code.service';
import { CreateCustomerRegistrationLinkDto } from './dto/create-customer-registration-link.dto';
import { UpdateCustomerRegistrationLinkStatusDto } from './dto/update-customer-registration-link-status.dto';

@Controller('customer-registration-link')
@UseGuards(JwtAuthGuard, CompanyActiveGuard, ExactRolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class CustomerRegistrationLinkController {
  constructor(
    private readonly service: CustomerRegistrationLinkService,
    private readonly qrCodeService: CustomerRegistrationQrCodeService,
  ) {}

  @Get('qr-code')
  getQrCode(@Req() request: RequestWithUser) {
    return this.qrCodeService.generate(request.user.companyId);
  }

  @Get()
  get(@Req() request: RequestWithUser) {
    return this.service.get(request.user.companyId);
  }

  @Post()
  create(
    @Body() _dto: CreateCustomerRegistrationLinkDto,
    @Req() request: RequestWithUser,
  ) {
    return this.service.create(request.user.companyId);
  }

  @Post('rotate')
  rotate(
    @Body() _dto: CreateCustomerRegistrationLinkDto,
    @Req() request: RequestWithUser,
  ) {
    return this.service.rotate(request.user.companyId);
  }

  @Patch('status')
  updateStatus(
    @Body() dto: UpdateCustomerRegistrationLinkStatusDto,
    @Req() request: RequestWithUser,
  ) {
    return this.service.updateStatus(request.user.companyId, dto.active);
  }
}
