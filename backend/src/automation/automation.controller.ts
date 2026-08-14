import {
  Controller,
  Delete,
  Param,
  Post,
  Patch,
  Body,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';

import { AutomationService } from './automation.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';
import { DispatchCampaignDto } from './dto/dispatch-campaign.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { PreviewCampaignAudienceDto } from './dto/preview-campaign-audience.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';

@UseGuards(JwtAuthGuard, CompanyActiveGuard)
@Controller('automation')
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Post()
  create(@Body() data: CreateAutomationDto, @Request() req: RequestWithUser) {
    return this.automationService.create(data, req.user.companyId);
  }

  @Post('campaign')
  createCampaign(
    @Body() data: CreateCampaignDto,
    @Request() req: RequestWithUser,
  ) {
    return this.automationService.createCampaign(data, req.user.companyId);
  }

  @Get()
  findAll(@Request() req: RequestWithUser) {
    return this.automationService.findAll(req.user.companyId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.automationService.remove(id, req.user.companyId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() data: UpdateAutomationDto,
    @Request() req: RequestWithUser,
  ) {
    return this.automationService.update(id, data, req.user.companyId);
  }

  @Post(':id/campaign/dispatch')
  @HttpCode(HttpStatus.ACCEPTED)
  dispatchCampaign(
    @Param('id') id: string,
    @Body() data: DispatchCampaignDto,
    @Request() req: RequestWithUser,
  ) {
    return this.automationService.dispatchCampaign(
      id,
      data,
      req.user.companyId,
    );
  }

  @Post(':id/campaign/audience-preview')
  @HttpCode(HttpStatus.OK)
  previewCampaignAudience(
    @Param('id') id: string,
    @Body() data: PreviewCampaignAudienceDto,
    @Request() req: RequestWithUser,
  ) {
    return this.automationService.previewCampaignAudience(
      id,
      req.user.companyId,
      data,
    );
  }
}
