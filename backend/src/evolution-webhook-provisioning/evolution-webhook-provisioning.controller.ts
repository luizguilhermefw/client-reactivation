import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
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
import { EnsureEvolutionWebhookDto } from './dto/ensure-evolution-webhook.dto';
import { EvolutionWebhookProvisioningService } from './evolution-webhook-provisioning.service';

@Controller('company/evolution/webhook')
export class EvolutionWebhookProvisioningController {
  constructor(
    private readonly provisioningService: EvolutionWebhookProvisioningService,
  ) {}

  @Post('ensure')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CompanyActiveGuard, ExactRolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  ensureConfigured(
    @Body() _dto: EnsureEvolutionWebhookDto,
    @Req() request: RequestWithUser,
  ) {
    return this.provisioningService.ensureConfigured(request.user.companyId);
  }
}
