import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { EVOLUTION_WEBHOOK_SECRET_HEADER } from '../webhook/evolution-webhook-secret.guard';
import type {
  EvolutionWebhookProvisioningConfig,
  EvolutionWebhookProvisioningConfigResolver,
} from './evolution-webhook-provisioning-config.interface';
import { EVOLUTION_WEBHOOK_PROVISIONING_CONFIG_RESOLVER } from './evolution-webhook-provisioning-config.token';

export const EVOLUTION_MESSAGES_UPSERT_EVENT = 'MESSAGES_UPSERT';

interface CurrentEvolutionWebhook {
  enabled: boolean;
  url?: string;
  events: string[];
  headers: Record<string, string>;
}

export interface EvolutionWebhookProvisioningResult {
  instanceName: string;
  configured: true;
  changed: boolean;
  url: string;
  events: [typeof EVOLUTION_MESSAGES_UPSERT_EVENT];
}

@Injectable()
export class EvolutionWebhookProvisioningService {
  constructor(
    @Inject(EVOLUTION_WEBHOOK_PROVISIONING_CONFIG_RESOLVER)
    private readonly configResolver: EvolutionWebhookProvisioningConfigResolver,
  ) {}

  async ensureConfigured(
    companyId: string,
  ): Promise<EvolutionWebhookProvisioningResult> {
    const config = this.configResolver.resolve(companyId);
    const currentWebhook = await this.findCurrentWebhook(config);

    if (currentWebhook && this.isExpectedConfiguration(currentWebhook, config)) {
      return this.result(config, false);
    }

    await this.setWebhook(config);
    const confirmedWebhook = await this.findCurrentWebhook(config, 'confirm');

    if (
      !confirmedWebhook ||
      !this.isExpectedConfiguration(confirmedWebhook, config)
    ) {
      throw this.unavailable('confirm');
    }

    return this.result(config, true);
  }

  private async findCurrentWebhook(
    config: EvolutionWebhookProvisioningConfig,
    operation: 'inspect' | 'confirm' = 'inspect',
  ): Promise<CurrentEvolutionWebhook | null> {
    const response = await this.request(
      `${config.apiUrl}/webhook/find/${encodeURIComponent(config.instanceName)}`,
      {
        method: 'GET',
        headers: { apikey: config.apiKey },
      },
      config.timeoutMs,
      operation,
    );

    if (response.status === 404) return null;
    if (!response.ok) throw this.unavailable(operation);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw this.unavailable(operation);
    }

    if (body === null) return null;
    if (!this.isRecord(body)) throw this.unavailable(operation);

    const rawWebhook = this.isRecord(body.webhook) ? body.webhook : body;
    const events = Array.isArray(rawWebhook.events)
      ? rawWebhook.events.filter(
          (event): event is string => typeof event === 'string',
        )
      : [];

    return {
      enabled: rawWebhook.enabled === true,
      ...(typeof rawWebhook.url === 'string' ? { url: rawWebhook.url } : {}),
      events,
      headers: this.normalizeHeaders(rawWebhook.headers),
    };
  }

  private async setWebhook(
    config: EvolutionWebhookProvisioningConfig,
  ): Promise<void> {
    const response = await this.request(
      `${config.apiUrl}/webhook/set/${encodeURIComponent(config.instanceName)}`,
      {
        method: 'POST',
        headers: {
          apikey: config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: config.publicUrl,
            byEvents: false,
            base64: false,
            headers: {
              [EVOLUTION_WEBHOOK_SECRET_HEADER]: config.secret,
            },
            events: [EVOLUTION_MESSAGES_UPSERT_EVENT],
          },
        }),
      },
      config.timeoutMs,
      'configure',
    );

    if (!response.ok) throw this.unavailable('configure');
  }

  private async request(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    operation: 'inspect' | 'configure' | 'confirm',
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw this.unavailable(operation);
    } finally {
      clearTimeout(timeout);
    }
  }

  private isExpectedConfiguration(
    current: CurrentEvolutionWebhook,
    expected: EvolutionWebhookProvisioningConfig,
  ): boolean {
    const currentSecret = this.findHeader(
      current.headers,
      EVOLUTION_WEBHOOK_SECRET_HEADER,
    );

    return (
      current.enabled &&
      current.url === expected.publicUrl &&
      current.events.includes(EVOLUTION_MESSAGES_UPSERT_EVENT) &&
      currentSecret !== undefined &&
      this.secretsMatch(expected.secret, currentSecret)
    );
  }

  private normalizeHeaders(value: unknown): Record<string, string> {
    if (!this.isRecord(value)) return {};

    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }

  private findHeader(
    headers: Record<string, string>,
    expectedName: string,
  ): string | undefined {
    const normalizedName = expectedName.toLowerCase();
    return Object.entries(headers).find(
      ([name]) => name.toLowerCase() === normalizedName,
    )?.[1];
  }

  private secretsMatch(expected: string, received: string): boolean {
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);

    return (
      expectedBuffer.length === receivedBuffer.length &&
      timingSafeEqual(expectedBuffer, receivedBuffer)
    );
  }

  private result(
    config: EvolutionWebhookProvisioningConfig,
    changed: boolean,
  ): EvolutionWebhookProvisioningResult {
    return {
      instanceName: config.instanceName,
      configured: true,
      changed,
      url: config.publicUrl,
      events: [EVOLUTION_MESSAGES_UPSERT_EVENT],
    };
  }

  private unavailable(
    operation: 'inspect' | 'configure' | 'confirm',
  ): ServiceUnavailableException {
    const messages = {
      inspect: 'Evolution webhook configuration could not be inspected',
      configure: 'Evolution webhook configuration could not be updated',
      confirm: 'Evolution webhook configuration could not be confirmed',
    } as const;

    return new ServiceUnavailableException(messages[operation]);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
