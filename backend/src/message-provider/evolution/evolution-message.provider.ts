import { Inject, Injectable } from '@nestjs/common';
import { MessageProvider } from '../contracts/message-provider.interface';
import {
  MessageProviderError,
  SendImageMessageInput,
  SendMessageResult,
  SendTextMessageInput,
} from '../contracts/message-provider.types';
import type { EvolutionConfigResolver } from './evolution-config-resolver.interface';
import { EVOLUTION_CONFIG_RESOLVER } from './evolution-config-resolver.token';
import type { MediaUrlPolicy } from '../media/media-url-policy.interface';
import { MediaUrlNotAllowedError } from '../media/media-url-policy.interface';
import { MEDIA_URL_POLICY } from '../media/media-url-policy.token';

interface EvolutionSendMessageResponse {
  key?: {
    id?: string;
  };
  messageId?: string;
  status?: string | number;
}

@Injectable()
export class EvolutionMessageProvider implements MessageProvider {
  constructor(
    @Inject(EVOLUTION_CONFIG_RESOLVER)
    private readonly configResolver: EvolutionConfigResolver,
    @Inject(MEDIA_URL_POLICY)
    private readonly mediaUrlPolicy: MediaUrlPolicy,
  ) {}

  async sendText(input: SendTextMessageInput): Promise<SendMessageResult> {
    const normalizedPhone = this.validateTextInput(input);

    return this.sendMessage(input.companyId, 'sendText', {
      number: normalizedPhone,
      text: input.content,
    });
  }

  async sendImage(input: SendImageMessageInput): Promise<SendMessageResult> {
    const normalizedPhone = this.validateImageInput(input);
    this.assertMediaUrlAllowed(input.mediaUrl);

    return this.sendMessage(input.companyId, 'sendMedia', {
      number: normalizedPhone,
      mediatype: 'image',
      mimetype: input.mimeType,
      caption: input.caption ?? '',
      media: input.mediaUrl,
      fileName: input.fileName,
    });
  }

  private assertMediaUrlAllowed(mediaUrl: string): void {
    try {
      this.mediaUrlPolicy.assertAllowed(mediaUrl);
    } catch (error) {
      if (error instanceof MediaUrlNotAllowedError) {
        throw new MessageProviderError('Media URL is not allowed', {
          code: 'MEDIA_URL_NOT_ALLOWED',
          retryable: false,
        });
      }

      throw error;
    }
  }

  private async sendMessage(
    companyId: string,
    endpoint: 'sendText' | 'sendMedia',
    body: Record<string, unknown>,
  ): Promise<SendMessageResult> {
    const config = this.configResolver.resolve(companyId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const url = `${config.apiUrl}/message/${endpoint}/${encodeURIComponent(
      config.instanceName,
    )}`;
    let phase: 'fetch' | 'response' = 'fetch';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          apikey: config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw this.mapHttpError(response.status);
      }

      phase = 'response';
      const responseBody: unknown = await response.json();
      const payload: EvolutionSendMessageResponse =
        responseBody !== null && typeof responseBody === 'object'
          ? (responseBody as EvolutionSendMessageResponse)
          : {};

      const providerMessageId =
        this.nonEmptyString(payload.key?.id) ??
        this.nonEmptyString(payload.messageId);

      if (!providerMessageId) {
        throw this.invalidProviderResponse();
      }

      const rawStatus =
        payload.status === undefined ? undefined : String(payload.status);

      return {
        provider: 'EVOLUTION',
        providerMessageId,
        ...(rawStatus === undefined ? {} : { rawStatus }),
      };
    } catch (error) {
      if (error instanceof MessageProviderError) {
        throw error;
      }

      if (this.isAbortError(error, controller.signal)) {
        throw this.providerTimeoutError();
      }

      if (phase === 'response') {
        throw this.invalidProviderResponse();
      }

      throw new MessageProviderError(
        'Message provider network request failed',
        {
          code: 'PROVIDER_NETWORK_ERROR',
          retryable: true,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateTextInput(input: SendTextMessageInput): string {
    if (!input.companyId?.trim()) {
      throw this.invalidInput('companyId is required');
    }

    if (!input.recipientPhone?.trim()) {
      throw this.invalidInput('recipientPhone is required');
    }

    if (!input.content?.trim()) {
      throw this.invalidInput('content is required');
    }

    if (!input.idempotencyKey?.trim()) {
      throw this.invalidInput('idempotencyKey is required');
    }

    return this.normalizePhone(input.recipientPhone);
  }

  private validateImageInput(input: SendImageMessageInput): string {
    if (!input.companyId?.trim()) {
      throw this.invalidInput('companyId is required');
    }

    if (!input.recipientPhone?.trim()) {
      throw this.invalidInput('recipientPhone is required');
    }

    if (!input.mediaUrl?.trim()) {
      throw this.invalidInput('mediaUrl is required');
    }

    if (input.mimeType !== 'image/jpeg' && input.mimeType !== 'image/png') {
      throw this.invalidInput('mimeType must be image/jpeg or image/png');
    }

    if (!input.fileName?.trim()) {
      throw this.invalidInput('fileName is required');
    }

    if (input.caption !== undefined && typeof input.caption !== 'string') {
      throw this.invalidInput('caption must be a string');
    }

    if (!input.idempotencyKey?.trim()) {
      throw this.invalidInput('idempotencyKey is required');
    }

    return this.normalizePhone(input.recipientPhone);
  }

  private normalizePhone(recipientPhone: string): string {
    const normalizedPhone = recipientPhone.replace(/\D/g, '');

    if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
      throw this.invalidInput('recipientPhone must contain 10 to 15 digits');
    }

    return normalizedPhone;
  }

  private mapHttpError(statusCode: number): MessageProviderError {
    if (statusCode === 408) {
      return new MessageProviderError('Message provider request timed out', {
        code: 'PROVIDER_TIMEOUT',
        retryable: true,
        statusCode,
      });
    }

    if (statusCode === 429) {
      return new MessageProviderError('Message provider rate limit exceeded', {
        code: 'PROVIDER_RATE_LIMITED',
        retryable: true,
        statusCode,
      });
    }

    if (statusCode >= 500 && statusCode <= 599) {
      return new MessageProviderError(
        'Message provider is temporarily unavailable',
        {
          code: 'PROVIDER_UNAVAILABLE',
          retryable: true,
          statusCode,
        },
      );
    }

    if (statusCode === 400) {
      return new MessageProviderError('Message request was rejected', {
        code: 'INVALID_MESSAGE_REQUEST',
        retryable: false,
        statusCode,
      });
    }

    if (statusCode === 401 || statusCode === 403) {
      return new MessageProviderError(
        'Message provider authentication failed',
        {
          code: 'PROVIDER_AUTHENTICATION_FAILED',
          retryable: false,
          statusCode,
        },
      );
    }

    if (statusCode === 404) {
      return new MessageProviderError(
        'Message provider instance was not found',
        {
          code: 'PROVIDER_INSTANCE_NOT_FOUND',
          retryable: false,
          statusCode,
        },
      );
    }

    return new MessageProviderError('Message provider request failed', {
      code: 'PROVIDER_REQUEST_FAILED',
      retryable: false,
      statusCode,
    });
  }

  private invalidInput(message: string): MessageProviderError {
    return new MessageProviderError(message, {
      code: 'INVALID_MESSAGE_INPUT',
      retryable: false,
    });
  }

  private invalidProviderResponse(): MessageProviderError {
    return new MessageProviderError(
      'Message provider returned an invalid response',
      {
        code: 'INVALID_PROVIDER_RESPONSE',
        retryable: false,
      },
    );
  }

  private providerTimeoutError(): MessageProviderError {
    return new MessageProviderError('Message provider request timed out', {
      code: 'PROVIDER_TIMEOUT',
      retryable: true,
    });
  }

  private isAbortError(error: unknown, signal: AbortSignal): boolean {
    return (
      signal.aborted || (error instanceof Error && error.name === 'AbortError')
    );
  }

  private nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
