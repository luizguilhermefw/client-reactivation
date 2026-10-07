import { randomBytes } from 'node:crypto';
import type { MessageProvider } from '../contracts/message-provider.interface';
import {
  MessageProviderError,
  SendTemplateMessageInput,
} from '../contracts/message-provider.types';
import { MetaCloudMessageProvider } from './meta-cloud-message.provider';

describe('MetaCloudMessageProvider', () => {
  const resolver = { resolve: jest.fn() };
  const provider: MessageProvider = new MetaCloudMessageProvider(resolver);
  const originalFetch = global.fetch;
  const fetchMock = jest.fn<typeof fetch>();
  const input: SendTemplateMessageInput = {
    type: 'TEMPLATE',
    companyId: 'tenant-a',
    messagingChannelId: 'channel-a',
    recipientPhone: '+55 (45) 99999-9999',
    idempotencyKey: 'internal-key',
    templateName: 'hello_world',
    languageCode: 'en_US',
  };
  let secret: string;

  beforeEach(() => {
    jest.resetAllMocks();
    secret = randomBytes(32).toString('hex');
    global.fetch = fetchMock;
    resolver.resolve.mockResolvedValue({
      accessToken: secret,
      phoneNumberId: '123456',
      graphVersion: 'v99.0',
      timeoutMs: 10_000,
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), {
        status: 200,
      }),
    );
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('sends a template with normalized phone, bearer auth and no internal fields', async () => {
    await expect(provider.sendTemplate(input)).resolves.toEqual({
      provider: 'META_CLOUD',
      providerMessageId: 'wamid.test',
    });
    expect(resolver.resolve).toHaveBeenCalledWith('tenant-a', 'channel-a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v99.0/123456/messages');
    expect(options?.method).toBe('POST');
    const headers = new Headers(options?.headers);
    expect(headers.get('Authorization') === `Bearer ${secret}`).toBe(true);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(options?.redirect).toBe('error');
    expect(options?.body).toBe(
      JSON.stringify({
        messaging_product: 'whatsapp',
        to: '5545999999999',
        type: 'template',
        template: { name: 'hello_world', language: { code: 'en_US' } },
      }),
    );
  });

  it('maps explicit ordered template body text parameters', async () => {
    await provider.sendTemplate({ ...input, bodyParameters: ['Example'] });
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        messaging_product: 'whatsapp',
        to: '5545999999999',
        type: 'template',
        template: {
          name: 'hello_world',
          language: { code: 'en_US' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: 'Example' }] },
          ],
        },
      }),
    );
  });

  it('rejects TEXT and IMAGE terminally without configuration resolution or HTTP', async () => {
    await expect(
      provider.sendText({ ...input, type: 'TEXT', content: 'text' }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_MESSAGE_TYPE',
      retryable: false,
    });
    await expect(
      provider.sendImage({
        ...input,
        mediaUrl: 'https://example.test/image.png',
        mimeType: 'image/png',
        fileName: 'image.png',
      }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_MESSAGE_TYPE',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'INVALID_MESSAGE_REQUEST', false],
    [401, 'PROVIDER_AUTHENTICATION_FAILED', false],
    [403, 'PROVIDER_AUTHENTICATION_FAILED', false],
    [404, 'PROVIDER_REQUEST_FAILED', false],
    [408, 'PROVIDER_TIMEOUT', true],
    [429, 'PROVIDER_RATE_LIMITED', true],
    [500, 'PROVIDER_UNAVAILABLE', true],
    [503, 'PROVIDER_UNAVAILABLE', true],
    [504, 'PROVIDER_TIMEOUT', true],
  ])('maps HTTP %s safely', async (status, code, retryable) => {
    fetchMock.mockResolvedValue(
      new Response(secret, { status: Number(status) }),
    );
    const error: unknown = await provider
      .sendTemplate(input)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(MessageProviderError);
    expect(error).toMatchObject({ code, retryable, statusCode: status });
    expect(String(error).includes(secret)).toBe(false);
  });

  it.each([
    null,
    {},
    { messages: [] },
    { messages: [{ id: '' }] },
    { messages: [{ id: 1 }] },
  ])('rejects malformed response %#', async (body) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(provider.sendTemplate(input)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
      retryable: false,
    });
  });

  it('does not return an echoed credential in the message ID', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: secret }] })),
    );
    const error: unknown = await provider
      .sendTemplate(input)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    expect(String(error).includes(secret)).toBe(false);
  });

  it('sanitizes network failures', async () => {
    fetchMock.mockRejectedValue(new Error(secret));
    const error: unknown = await provider
      .sendTemplate(input)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: 'PROVIDER_NETWORK_ERROR',
      retryable: true,
    });
    expect(String(error).includes(secret)).toBe(false);
  });

  it('handles malformed JSON safely', async () => {
    fetchMock.mockResolvedValue(new Response('invalid JSON'));
    await expect(provider.sendTemplate(input)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
      retryable: false,
    });
  });

  it('aborts the request at the configured timeout', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const expectation = expect(
      provider.sendTemplate(input),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', retryable: true });
    await jest.advanceTimersByTimeAsync(10_000);
    await expectation;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not fetch when configuration resolution fails', async () => {
    resolver.resolve.mockRejectedValue(
      new MessageProviderError('Message provider configuration is incomplete', {
        code: 'PROVIDER_CONFIGURATION_ERROR',
        retryable: false,
      }),
    );
    await expect(provider.sendTemplate(input)).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { recipientPhone: '1' },
    { companyId: '' },
    { messagingChannelId: '' },
    { idempotencyKey: '' },
    { templateName: '../bad' },
    { languageCode: '' },
    { bodyParameters: [42] },
    { type: 'TEXT' },
  ])('rejects invalid template input %# before HTTP', async (changes) => {
    await expect(
      provider.sendTemplate({
        ...input,
        ...changes,
      } as SendTemplateMessageInput),
    ).rejects.toMatchObject({
      code: 'INVALID_MESSAGE_INPUT',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
