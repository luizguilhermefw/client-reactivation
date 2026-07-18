import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';

import type { RequestWithUser } from '../auth/types/request-with-user';

@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  create(@Body() createCompanyDto: CreateCompanyDto) {
    return this.companyService.create(createCompanyDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, CompanyActiveGuard)
  findMe(@Req() req: RequestWithUser) {
    return this.companyService.findMe(req.user.companyId);
  }
}
