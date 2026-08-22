import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { EntitlementService } from './entitlement.service';

@Controller('company/entitlements')
export class CompanyEntitlementController {
  constructor(private readonly entitlementService: EntitlementService) {}

  @Get()
  @UseGuards(JwtAuthGuard, CompanyActiveGuard)
  async getEntitlements(@Req() request: RequestWithUser) {
    const limit = await this.entitlementService.getLimit(
      request.user.companyId,
      EntitlementFeature.WHATSAPP_CHANNELS,
    );

    return {
      whatsappChannels: { limit },
    };
  }
}
