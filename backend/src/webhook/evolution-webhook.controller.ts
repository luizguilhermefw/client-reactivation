import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EvolutionWebhookSecretGuard } from './evolution-webhook-secret.guard';
import { EvolutionWebhookService } from './evolution-webhook.service';

@UseGuards(EvolutionWebhookSecretGuard)
@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  constructor(
    private readonly evolutionWebhookService: EvolutionWebhookService,
  ) {}

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  async receiveMessage(@Body() payload: unknown) {
    const result = await this.evolutionWebhookService.handle(payload);

    return { status: result.status };
  }
}
