interface SendMessageInputBase {
  companyId: string;
  messagingChannelId: string;
  recipientPhone: string;
  idempotencyKey: string;
}

export interface SendTextMessageInput extends SendMessageInputBase {
  type?: 'TEXT';
  content: string;
}

export interface SendImageMessageInput extends SendMessageInputBase {
  mediaUrl: string;
  mimeType: 'image/jpeg' | 'image/png';
  fileName: string;
  caption?: string;
}

// Explicit template intent. This foundation does not enqueue templates.
export interface SendTemplateMessageInput extends SendMessageInputBase {
  type: 'TEMPLATE';
  templateName: string;
  languageCode: string;
  /** Ordered text parameters for the template body, when required. */
  bodyParameters?: string[];
}

export type SendMessageInput =
  | SendTextMessageInput
  | SendImageMessageInput
  | SendTemplateMessageInput;

export interface SendMessageResult {
  provider: string;
  providerMessageId: string;
  rawStatus?: string;
}

export type MessageProviderErrorCode =
  | 'UNSUPPORTED_MESSAGE_TYPE'
  | 'INVALID_MESSAGE_INPUT'
  | 'PROVIDER_CONFIGURATION_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_MESSAGE_REQUEST'
  | 'PROVIDER_AUTHENTICATION_FAILED'
  | 'PROVIDER_INSTANCE_NOT_FOUND'
  | 'PROVIDER_NETWORK_ERROR'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'PROVIDER_REQUEST_FAILED'
  | 'MEDIA_URL_NOT_ALLOWED'
  | 'INVALID_IMAGE_PAYLOAD';

export class MessageProviderError extends Error {
  readonly name = 'MessageProviderError';
  readonly code: MessageProviderErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      code: MessageProviderErrorCode;
      retryable: boolean;
      statusCode?: number;
    },
  ) {
    super(message);
    this.code = options.code;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}
