import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  Patch,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Put, Delete, Param } from '@nestjs/common';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('customer')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateCustomerDto, @Request() req) {
    return this.customerService.create(dto, req.user.companyId);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Request() req) {
    return this.customerService.findAll(req.user.companyId);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @Request() req,
  ) {
    return this.customerService.update(id, dto, req.user.companyId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.customerService.remove(id, req.user.companyId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/toggle-automation')
  toggleAutomation(@Param('id') id: string, @Request() req) {
    return this.customerService.toggleAutomation(id, req.user.companyId);
  }
}
