import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { CreateWhatsappChannelDto } from './dto/create-whatsapp-channel.dto';
import { MessagingChannelProvisioningService } from './messaging-channel-provisioning.service';

@Controller('company/messaging-channels/whatsapp')
export class MessagingChannelController {
  constructor(
    private readonly provisioningService: MessagingChannelProvisioningService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, CompanyActiveGuard)
  list(@Req() request: RequestWithUser) {
    return this.provisioningService.list(request.user.companyId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, CompanyActiveGuard, ExactRolesGuard)
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  provision(
    @Body() _body: CreateWhatsappChannelDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: RequestWithUser,
  ) {
    return this.provisioningService.provision(
      request.user.companyId,
      this.validateIdempotencyKey(idempotencyKey),
    );
  }

  @Post(':id/qr')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CompanyActiveGuard, ExactRolesGuard)
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  getQrCode(
    @Param('id', new ParseUUIDPipe()) channelId: string,
    @Req() request: RequestWithUser,
  ) {
    return this.provisioningService.getQrCode(
      request.user.companyId,
      channelId,
    );
  }

  @Get(':id/connection')
  @UseGuards(JwtAuthGuard, CompanyActiveGuard, ExactRolesGuard)
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  getConnection(
    @Param('id', new ParseUUIDPipe()) channelId: string,
    @Req() request: RequestWithUser,
  ) {
    return this.provisioningService.getConnection(
      request.user.companyId,
      channelId,
    );
  }

  private validateIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (
      !key ||
      key.length > 64 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    ) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }
    return key.toLowerCase();
  }
}
