import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';

import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@UseGuards(JwtAuthGuard, CompanyActiveGuard)
@Controller('customer')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto, @Req() request: RequestWithUser) {
    return this.customerService.create(dto, request.user.companyId);
  }

  @Get()
  findAll(@Req() request: RequestWithUser) {
    return this.customerService.findAll(request.user.companyId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() request: RequestWithUser,
  ) {
    return this.customerService.update(id, dto, request.user.companyId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: RequestWithUser) {
    return this.customerService.remove(id, request.user.companyId);
  }

  @Patch(':id/toggle-automation')
  toggleAutomation(@Param('id') id: string, @Req() request: RequestWithUser) {
    return this.customerService.toggleAutomation(id, request.user.companyId);
  }
}
