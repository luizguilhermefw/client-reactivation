import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { CustomerInterestOptionService } from './customer-interest-option.service';
import { CustomerInterestOptionFilterDto } from './dto/customer-interest-option-filter.dto';
import { CreateCustomerInterestOptionDto } from './dto/create-customer-interest-option.dto';
import { UpdateCustomerInterestOptionDto } from './dto/update-customer-interest-option.dto';
import { UpdateCustomerInterestOptionStatusDto } from './dto/update-customer-interest-option-status.dto';

@Controller('customer-interests/options')
@UseGuards(JwtAuthGuard, CompanyActiveGuard)
export class CustomerInterestController {
  constructor(private readonly service: CustomerInterestOptionService) {}

  @Post()
  @UseGuards(ExactRolesGuard)
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  create(
    @Body() dto: CreateCustomerInterestOptionDto,
    @Req() request: RequestWithUser,
  ) {
    return this.service.create(request.user.companyId, dto.type, dto.name);
  }

  @Get()
  list(
    @Query() filters: CustomerInterestOptionFilterDto,
    @Req() request: RequestWithUser,
  ) {
    return this.service.list(request.user.companyId, filters);
  }

  @Put(':id')
  @UseGuards(ExactRolesGuard)
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  updateName(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCustomerInterestOptionDto,
    @Req() request: RequestWithUser,
  ) {
    return this.service.updateName(request.user.companyId, id, dto.name);
  }

  @Patch(':id/status')
  @UseGuards(ExactRolesGuard)
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCustomerInterestOptionStatusDto,
    @Req() request: RequestWithUser,
  ) {
    return this.service.updateStatus(request.user.companyId, id, dto.active);
  }
}
