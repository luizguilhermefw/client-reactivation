import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const EVOLUTION_WEBHOOK_SECRET_HEADER = 'x-aylaflow-webhook-secret';

@Injectable()
export class EvolutionWebhookSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configuredSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
    const request = context.switchToHttp().getRequest<Request>();
    const receivedSecret = request.headers[EVOLUTION_WEBHOOK_SECRET_HEADER];

    if (
      !configuredSecret ||
      typeof receivedSecret !== 'string' ||
      !this.matches(configuredSecret, receivedSecret)
    ) {
      throw new UnauthorizedException('Webhook authentication failed');
    }

    return true;
  }

  private matches(expected: string, received: string): boolean {
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);

    return (
      expectedBuffer.length === receivedBuffer.length &&
      timingSafeEqual(expectedBuffer, receivedBuffer)
    );
  }
}
