import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { EntitlementFeature, UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SetWhatsappChannelsLimitDto } from './dto/set-whatsapp-channels-limit.dto';
import { EntitlementService } from './entitlement.service';

@Controller('admin/company')
export class AdminEntitlementController {
  constructor(private readonly entitlementService: EntitlementService) {}

  @Patch(':id/entitlements/whatsapp-channels')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async setWhatsappChannelsLimit(
    @Param('id') companyId: string,
    @Body() dto: SetWhatsappChannelsLimitDto,
  ) {
    const entitlement = await this.entitlementService.setManualLimit(
      companyId,
      EntitlementFeature.WHATSAPP_CHANNELS,
      dto.limit,
    );

    return {
      feature: entitlement.feature,
      limit: entitlement.limit,
      source: entitlement.source,
    };
  }
}
