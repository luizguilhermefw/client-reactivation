import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  Put,
  Delete,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';

@UseGuards(JwtAuthGuard)
@Controller('customer')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto, @Req() req: RequestWithUser) {
    return this.customerService.create(dto, req.user.companyId);
  }

  @Get()
  findAll(@Req() req: RequestWithUser) {
    return this.customerService.findAll(req.user.companyId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: RequestWithUser,
  ) {
    return this.customerService.update(id, dto, req.user.companyId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.customerService.remove(id, req.user.companyId);
  }

  @Patch(':id/toggle-automation')
  toggleAutomation(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.customerService.toggleAutomation(id, req.user.companyId);
  }
}