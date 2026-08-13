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

import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

import type { RequestWithUser } from '../auth/types/request-with-user';
import { CompanyMessagingPolicyService } from './company-messaging-policy.service';
import { UpdateCompanyMessagingPolicyDto } from './dto/update-company-messaging-policy.dto';

@Controller('company')
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly companyMessagingPolicyService: CompanyMessagingPolicyService,
  ) {}

  @Post()
  create(@Body() createCompanyDto: CreateCompanyDto) {
    return this.companyService.create(createCompanyDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, CompanyActiveGuard)
  findMe(@Req() req: RequestWithUser) {
    return this.companyService.findMe(req.user.companyId);
  }

  @Get('messaging-policy')
  @UseGuards(JwtAuthGuard, CompanyActiveGuard)
  getMessagingPolicy(@Req() request: RequestWithUser) {
    return this.companyMessagingPolicyService.getPolicy(request.user.companyId);
  }

  @Patch('messaging-policy/unknown-contacts')
  @UseGuards(JwtAuthGuard, CompanyActiveGuard, ExactRolesGuard)
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  updateUnknownContactPolicy(
    @Body() dto: UpdateCompanyMessagingPolicyDto,
    @Req() request: RequestWithUser,
  ) {
    return this.companyMessagingPolicyService.updateUnknownContactPolicy(
      request.user.companyId,
      request.user.userId,
      dto.policy,
      dto.declarationAccepted,
    );
  }
}
