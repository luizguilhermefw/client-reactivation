import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AutomationService } from './automation.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('automation')
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateAutomationDto, @Request() req) {
    return this.automationService.create(dto, req.user.companyId);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Request() req) {
    return this.automationService.findAll(req.user.companyId);
  }
}