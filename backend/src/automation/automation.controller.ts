import {
  Controller,
  Delete,
  Param,
  Post,
  Patch,
  Body,
  Get,
  UseGuards,
  Request,
} from '@nestjs/common';

import { AutomationService } from './automation.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';

@UseGuards(JwtAuthGuard, CompanyActiveGuard)
@Controller('automation')
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Post()
  create(@Body() data: CreateAutomationDto, @Request() req) {
    return this.automationService.create(data, req.user.companyId);
  }

  @Get()
  findAll(@Request() req) {
    return this.automationService.findAll(req.user.companyId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.automationService.remove(id, req.user.companyId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() data: UpdateAutomationDto,
    @Request() req,
  ) {
    return this.automationService.update(id, data, req.user.companyId);
  }
}
