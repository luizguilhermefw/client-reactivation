import {
  CanActivate,
  ExecutionContext,
  Injectable,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class MetaWebhookSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    const secret = process.env.META_WHATSAPP_APP_SECRET;
    const signature = request.headers['x-hub-signature-256'];
    if (
      !secret?.trim() ||
      !Buffer.isBuffer(request.rawBody) ||
      typeof signature !== 'string' ||
      !/^sha256=[a-fA-F0-9]{64}$/.test(signature)
    ) {
      throw new UnauthorizedException('Webhook authentication failed');
    }
    const expected = createHmac('sha256', secret)
      .update(request.rawBody)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) {
      throw new UnauthorizedException('Webhook authentication failed');
    }
    return true;
  }
}
