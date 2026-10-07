import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { MetaWebhookSignatureGuard } from './meta-webhook-signature.guard';
import { MetaWebhookService } from './meta-webhook.service';

@Controller('webhooks/meta')
export class MetaWebhookController {
  constructor(private readonly service: MetaWebhookService) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  verify(
    @Query('hub.mode') mode: unknown,
    @Query('hub.verify_token') token: unknown,
    @Query('hub.challenge') challenge: unknown,
  ): string {
    const expected = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (
      !expected?.trim() ||
      mode !== 'subscribe' ||
      typeof token !== 'string' ||
      typeof challenge !== 'string' ||
      !challenge ||
      Buffer.byteLength(expected) !== Buffer.byteLength(token) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(token))
    ) {
      throw new ForbiddenException('Webhook verification failed');
    }
    return challenge;
  }

  @Post()
  @HttpCode(200)
  @UseGuards(MetaWebhookSignatureGuard)
  async receive(@Body() payload: unknown) {
    await this.service.handle(payload);
    return { status: 'accepted' };
  }
}
