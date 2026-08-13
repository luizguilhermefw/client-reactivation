import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { EvolutionWebhookPayload } from './dto/evolution-webhook-payload';
import { EVOLUTION_INSTANCE_TENANT_RESOLVER } from './evolution-instance-tenant-resolver.interface';
import type { EvolutionInstanceTenantResolver } from './evolution-instance-tenant-resolver.interface';
import { InboundOptOutService } from './inbound-opt-out.service';
import { normalizeEvolutionPhone } from './phone-normalizer';
import type {
  InboundMessage,
  InboundMessageProcessingResult,
} from './types/inbound-message';

@Injectable()
export class EvolutionWebhookService {
  private readonly logger = new Logger(EvolutionWebhookService.name);

  constructor(
    @Inject(EVOLUTION_INSTANCE_TENANT_RESOLVER)
    private readonly tenantResolver: EvolutionInstanceTenantResolver,
    private readonly inboundOptOutService: InboundOptOutService,
  ) {}

  async handle(payload: unknown): Promise<InboundMessageProcessingResult> {
    const webhookPayload = this.parseEnvelope(payload);
    const event = webhookPayload.event.trim();
    const instanceName = webhookPayload.instance.trim();

    if (!this.isSupportedMessageEvent(event)) {
      this.logResult(event, instanceName, null, 'ignored');
      return { status: 'ignored', reason: 'unsupported-event' };
    }

    const message = this.normalizeMessage(webhookPayload, instanceName);

    if (!message) {
      this.logResult(event, instanceName, null, 'ignored');
      return { status: 'ignored', reason: 'invalid-message' };
    }

    if (message.fromMe) {
      this.logResult(event, instanceName, message.providerMessageId, 'ignored');
      return { status: 'ignored', reason: 'from-me' };
    }

    let companyId: string | null;

    try {
      companyId = await this.tenantResolver.resolveCompanyId(instanceName);
    } catch {
      companyId = null;
    }

    if (!companyId) {
      this.logResult(
        event,
        instanceName,
        message.providerMessageId,
        'unknown-instance',
      );
      return { status: 'ignored', reason: 'unknown-instance' };
    }

    await this.processInboundMessage(companyId, message);
    this.logResult(event, instanceName, message.providerMessageId, 'accepted');

    return {
      status: 'accepted',
      companyId,
      message,
    };
  }

  private parseEnvelope(
    payload: unknown,
  ): EvolutionWebhookPayload & { event: string; instance: string } {
    if (!this.isRecord(payload)) {
      throw new BadRequestException('Invalid Evolution webhook payload');
    }

    const event = this.nonEmptyString(payload.event);
    const instance = this.nonEmptyString(payload.instance);

    if (!event || !instance) {
      throw new BadRequestException('Invalid Evolution webhook payload');
    }

    return {
      ...payload,
      event,
      instance,
    };
  }

  private normalizeMessage(
    payload: EvolutionWebhookPayload,
    instanceName: string,
  ): InboundMessage | null {
    if (!this.isRecord(payload.data)) {
      throw new BadRequestException('Invalid Evolution webhook payload');
    }

    const data = payload.data;
    const key = this.isRecord(data.key) ? data.key : undefined;
    const remoteJid =
      this.nonEmptyString(key?.remoteJid) ??
      this.nonEmptyString(data.remoteJid);
    const phone = normalizeEvolutionPhone(remoteJid);
    const fromMeValue = key?.fromMe ?? data.fromMe;

    if (!phone || typeof fromMeValue !== 'boolean') {
      return null;
    }

    const providerMessageId =
      this.nonEmptyString(key?.id) ?? this.nonEmptyString(data.id) ?? null;

    return {
      provider: 'EVOLUTION',
      instanceName,
      providerMessageId,
      phone,
      text: this.extractText(data),
      fromMe: fromMeValue,
      receivedAt: this.parseTimestamp(data.messageTimestamp ?? data.timestamp),
    };
  }

  private extractText(data: Record<string, unknown>): string | null {
    if (!this.isRecord(data.message)) {
      return this.nonEmptyString(data.text) ?? null;
    }

    const extendedTextMessage = this.isRecord(data.message.extendedTextMessage)
      ? data.message.extendedTextMessage
      : undefined;

    return (
      this.nonEmptyString(data.message.conversation) ??
      this.nonEmptyString(extendedTextMessage?.text) ??
      this.nonEmptyString(data.text) ??
      null
    );
  }

  private parseTimestamp(value: unknown): Date | null {
    const timestamp =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value)
          : Number.NaN;

    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }

    const receivedAt = new Date(
      timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp,
    );

    return Number.isNaN(receivedAt.getTime()) ? null : receivedAt;
  }

  private isSupportedMessageEvent(event: string): boolean {
    return (
      event.trim().toLowerCase().replace(/[-_]/g, '.') === 'messages.upsert'
    );
  }

  private async processInboundMessage(
    companyId: string,
    message: InboundMessage,
  ): Promise<void> {
    await this.inboundOptOutService.process(companyId, message);
  }

  private logResult(
    event: string,
    instanceName: string,
    providerMessageId: string | null,
    result: 'accepted' | 'ignored' | 'unknown-instance',
  ): void {
    this.logger.log(
      `Evolution inbound event=${event} instance=${instanceName} providerMessageId=${providerMessageId ?? 'none'} result=${result}`,
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
