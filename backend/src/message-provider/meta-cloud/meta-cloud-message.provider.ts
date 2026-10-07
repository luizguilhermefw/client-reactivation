import { Inject, Injectable } from '@nestjs/common';
import type { MessageProvider } from '../contracts/message-provider.interface';
import {
  MessageProviderError,
  SendMessageResult,
  SendTemplateMessageInput,
} from '../contracts/message-provider.types';
import type { MetaCloudConfigResolver } from './meta-cloud-config-resolver.interface';
import { META_CLOUD_CONFIG_RESOLVER } from './meta-cloud-config-resolver.token';

@Injectable()
export class MetaCloudMessageProvider implements MessageProvider {
  constructor(
    @Inject(META_CLOUD_CONFIG_RESOLVER)
    private readonly configResolver: MetaCloudConfigResolver,
  ) {}

  sendText(): Promise<SendMessageResult> {
    return Promise.reject(this.unsupportedType());
  }

  sendImage(): Promise<SendMessageResult> {
    return Promise.reject(this.unsupportedType());
  }

  async sendTemplate(
    input: SendTemplateMessageInput,
  ): Promise<SendMessageResult> {
    const phone = this.validateInput(input);
    const config = await this.configResolver.resolve(
      input.companyId,
      input.messagingChannelId,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let phase: 'fetch' | 'response' = 'fetch';
    try {
      const response = await fetch(
        `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone,
            type: 'template',
            template: {
              name: input.templateName,
              language: { code: input.languageCode },
              ...(input.bodyParameters?.length
                ? {
                    components: [
                      {
                        type: 'body',
                        parameters: input.bodyParameters.map((text) => ({
                          type: 'text',
                          text,
                        })),
                      },
                    ],
                  }
                : {}),
            },
          }),
          redirect: 'error',
          signal: controller.signal,
        },
      );
      if (!response.ok) throw this.httpError(response.status);
      phase = 'response';
      const payload: unknown = await response.json();
      const messages = this.isRecord(payload) ? payload.messages : undefined;
      const first: unknown = Array.isArray(messages) ? messages[0] : undefined;
      const id = this.isRecord(first) ? first.id : undefined;
      if (
        typeof id !== 'string' ||
        !id.trim() ||
        id.includes(config.accessToken)
      ) {
        throw this.invalidResponse();
      }
      return { provider: 'META_CLOUD', providerMessageId: id.trim() };
    } catch (error) {
      if (error instanceof MessageProviderError) throw error;
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw new MessageProviderError('Message provider request timed out', {
          code: 'PROVIDER_TIMEOUT',
          retryable: true,
        });
      }
      if (phase === 'response') throw this.invalidResponse();
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

  private validateInput(input: SendTemplateMessageInput): string {
    const required = [
      input?.companyId,
      input?.messagingChannelId,
      input?.recipientPhone,
      input?.idempotencyKey,
      input?.templateName,
      input?.languageCode,
    ];
    if (
      required.some((value) => typeof value !== 'string' || !value.trim()) ||
      input?.type !== 'TEMPLATE' ||
      !/^[a-z0-9_]+$/.test(input.templateName) ||
      !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(input.languageCode) ||
      (input.bodyParameters !== undefined &&
        (!Array.isArray(input.bodyParameters) ||
          input.bodyParameters.some(
            (value) => typeof value !== 'string' || !value.trim(),
          )))
    ) {
      throw this.invalidInput();
    }
    const phone = input.recipientPhone.replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 15) throw this.invalidInput();
    return phone;
  }

  private httpError(statusCode: number): MessageProviderError {
    if (statusCode === 408 || statusCode === 504) {
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
    if (statusCode >= 500) {
      return new MessageProviderError(
        'Message provider is temporarily unavailable',
        {
          code: 'PROVIDER_UNAVAILABLE',
          retryable: true,
          statusCode,
        },
      );
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
    return new MessageProviderError('Message request was rejected', {
      code:
        statusCode === 400
          ? 'INVALID_MESSAGE_REQUEST'
          : 'PROVIDER_REQUEST_FAILED',
      retryable: false,
      statusCode,
    });
  }

  private unsupportedType(): MessageProviderError {
    return new MessageProviderError(
      'Message type is not supported by this provider',
      {
        code: 'UNSUPPORTED_MESSAGE_TYPE',
        retryable: false,
      },
    );
  }

  private invalidInput(): MessageProviderError {
    return new MessageProviderError('Template message input is invalid', {
      code: 'INVALID_MESSAGE_INPUT',
      retryable: false,
    });
  }

  private invalidResponse(): MessageProviderError {
    return new MessageProviderError(
      'Message provider returned an invalid response',
      {
        code: 'INVALID_PROVIDER_RESPONSE',
        retryable: false,
      },
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
}
