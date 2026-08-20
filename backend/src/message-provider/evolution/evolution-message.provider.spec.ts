import {
  MessageProviderError,
  SendImageMessageInput,
  SendTextMessageInput,
} from '../contracts/message-provider.types';
import {
  EvolutionConfigResolver,
  EvolutionProviderConfig,
} from './evolution-config-resolver.interface';
import { EvolutionMessageProvider } from './evolution-message.provider';
import {
  MediaUrlNotAllowedError,
  MediaUrlPolicy,
} from '../media/media-url-policy.interface';

describe('EvolutionMessageProvider', () => {
  let provider: EvolutionMessageProvider;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  const config: EvolutionProviderConfig = {
    apiUrl: 'https://evolution.example.com',
    apiKey: 'super-secret-api-key',
    instanceName: 'Ayla Flow/Primary',
    timeoutMs: 10_000,
  };
  const configResolverMock = {
    resolve: jest.fn(),
  };
  const mediaUrlPolicyMock: jest.Mocked<MediaUrlPolicy> = {
    assertAllowed: jest.fn(),
  };

  const input: SendTextMessageInput = {
    companyId: 'company-1',
    recipientPhone: '(11) 99999-9999',
    content: 'Mensagem de teste',
    idempotencyKey: 'message-1',
  };

  const imageInput: SendImageMessageInput = {
    companyId: 'company-1',
    recipientPhone: '(11) 99999-9999',
    mediaUrl: 'https://storage.example.com/campaign/image.jpg',
    mimeType: 'image/jpeg',
    fileName: 'campaign.jpg',
    caption: 'Legenda de teste',
    idempotencyKey: 'image-message-1',
  };

  const response = (status: number, body: unknown): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: jest.fn().mockResolvedValue(body),
    }) as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();
    configResolverMock.resolve.mockResolvedValue(config);
    mediaUrlPolicyMock.assertAllowed.mockImplementation(() => undefined);

    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      response(200, {
        key: {
          id: 'provider-message-1',
        },
        status: 'PENDING',
      }),
    );
    provider = new EvolutionMessageProvider(
      configResolverMock as unknown as EvolutionConfigResolver,
      mediaUrlPolicyMock,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('chama o resolver com o companyId correto', async () => {
    await provider.sendText(input);

    expect(configResolverMock.resolve).toHaveBeenCalledWith(input.companyId);
  });

  it('usa exclusivamente a configuração retornada pelo resolver', async () => {
    configResolverMock.resolve.mockResolvedValue({
      apiUrl: 'https://tenant-provider.example.com',
      apiKey: 'tenant-api-key',
      instanceName: 'tenant-instance',
      timeoutMs: 5_000,
    });

    await provider.sendText(input);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://tenant-provider.example.com/message/sendText/tenant-instance',
      expect.objectContaining({
        headers: {
          apikey: 'tenant-api-key',
          'Content-Type': 'application/json',
        },
      }),
    );
  });

  it('keeps TEXT and IMAGE on the instance resolved for each company', async () => {
    configResolverMock.resolve.mockImplementation(
      async (companyId: string) => ({
        ...config,
        instanceName: companyId === 'company-a' ? 'instance-a' : 'instance-b',
      }),
    );

    await provider.sendText({ ...input, companyId: 'company-a' });
    await provider.sendImage({ ...imageInput, companyId: 'company-b' });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://evolution.example.com/message/sendText/instance-a',
      'https://evolution.example.com/message/sendMedia/instance-b',
    ]);
    expect(configResolverMock.resolve).toHaveBeenNthCalledWith(1, 'company-a');
    expect(configResolverMock.resolve).toHaveBeenNthCalledWith(2, 'company-b');
  });

  it('normaliza telefone removendo a máscara', async () => {
    await provider.sendText(input);

    const request = fetchMock.mock.calls[0][1];
    expect(JSON.parse(request?.body as string)).toEqual(
      expect.objectContaining({
        number: '11999999999',
      }),
    );
  });

  it('envia URL, headers e body corretos', async () => {
    await provider.sendText(input);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/message/sendText/Ayla%20Flow%2FPrimary',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'super-secret-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          number: '11999999999',
          text: input.content,
        }),
      }),
    );
    expect(mediaUrlPolicyMock.assertAllowed).not.toHaveBeenCalled();
  });

  it('envia o celular canônico uma única vez e não tenta a variante legada', async () => {
    const canonicalPhone = '5545999029181';
    const legacyPhone = '554599029181';

    await provider.sendText({
      ...input,
      recipientPhone: canonicalPhone,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      fetchMock.mock.calls[0][1]?.body as string,
    ) as Record<string, unknown>;
    expect(body.number).toBe(canonicalPhone);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(legacyPhone);
  });

  it('preserva telefone fixo em uma única tentativa', async () => {
    const landlinePhone = '554533334444';

    await provider.sendText({
      ...input,
      recipientPhone: landlinePhone,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]?.body as string),
    ).toMatchObject({ number: landlinePhone });
  });

  it('não envia dados internos no body externo', async () => {
    await provider.sendText(input);

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(request?.body as string) as Record<string, unknown>;

    expect(body).not.toHaveProperty('textMessage');
    expect(body).not.toHaveProperty('idempotencyKey');
    expect(body).not.toHaveProperty('companyId');
  });

  it('codifica instanceName na URL', async () => {
    configResolverMock.resolve.mockResolvedValue({
      ...config,
      instanceName: 'Instance / São Paulo',
    });

    await provider.sendText(input);

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://evolution.example.com/message/sendText/Instance%20%2F%20S%C3%A3o%20Paulo',
    );
  });

  it('retorna providerMessageId preferencialmente de key.id', async () => {
    fetchMock.mockResolvedValue(
      response(200, {
        key: {
          id: 'key-id-1',
        },
        messageId: 'fallback-id-1',
        status: 'SENT',
      }),
    );

    await expect(provider.sendText(input)).resolves.toEqual({
      provider: 'EVOLUTION',
      providerMessageId: 'key-id-1',
      rawStatus: 'SENT',
    });
  });

  it('usa messageId como fallback', async () => {
    fetchMock.mockResolvedValue(
      response(200, {
        messageId: 'fallback-id-1',
      }),
    );

    await expect(provider.sendText(input)).resolves.toEqual({
      provider: 'EVOLUTION',
      providerMessageId: 'fallback-id-1',
    });
  });

  it('rejeita resposta sem identificação da mensagem', async () => {
    fetchMock.mockResolvedValue(response(200, { status: 'PENDING' }));

    await expect(provider.sendText(input)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
      retryable: false,
    });
  });

  it('rejeita configuração ausente antes da chamada HTTP', async () => {
    configResolverMock.resolve.mockRejectedValue(
      new MessageProviderError('Message provider configuration is incomplete', {
        code: 'PROVIDER_CONFIGURATION_ERROR',
        retryable: false,
      }),
    );

    await expect(provider.sendText(input)).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita telefone inválido', async () => {
    await expect(
      provider.sendText({
        ...input,
        recipientPhone: '123-456',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_MESSAGE_INPUT',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['companyId', ''],
    ['recipientPhone', ''],
    ['content', '   '],
    ['idempotencyKey', ''],
  ] as const)(
    'rejeita entrada obrigatória ausente: %s',
    async (field, value) => {
      await expect(
        provider.sendText({
          ...input,
          [field]: value,
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_MESSAGE_INPUT',
        retryable: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('mapeia AbortError como timeout retryable', async () => {
    const abortError = new Error('request aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    await expect(provider.sendText(input)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      retryable: true,
    });
  });

  it('mantém o timeout ativo durante response.json e mapeia AbortError como retryable', async () => {
    jest.useFakeTimers();
    configResolverMock.resolve.mockResolvedValue({
      ...config,
      timeoutMs: 100,
    });
    fetchMock.mockImplementation(async (_url, request) => {
      const signal = request?.signal as AbortSignal;

      return {
        ok: true,
        status: 200,
        json: jest.fn(
          () =>
            new Promise((_resolve, reject) => {
              const rejectWithAbort = () => {
                const error = new Error('response body aborted');
                error.name = 'AbortError';
                reject(error);
              };

              if (signal.aborted) {
                rejectWithAbort();
                return;
              }

              signal.addEventListener('abort', rejectWithAbort, {
                once: true,
              });
            }),
        ),
      } as unknown as Response;
    });

    const assertion = expect(provider.sendText(input)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      retryable: true,
    });

    await jest.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('mapeia falha de response.json como resposta inválida não retryable', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockRejectedValue(new SyntaxError('Invalid JSON')),
    } as unknown as Response);

    await expect(provider.sendText(input)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
      retryable: false,
    });
  });

  it('mapeia status 408 como timeout retryable', async () => {
    fetchMock.mockResolvedValue(response(408, {}));

    await expect(provider.sendText(input)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      retryable: true,
      statusCode: 408,
    });
  });

  it.each([
    {
      status: 429,
      code: 'PROVIDER_RATE_LIMITED',
      retryable: true,
    },
    {
      status: 500,
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    },
    {
      status: 400,
      code: 'INVALID_MESSAGE_REQUEST',
      retryable: false,
    },
    {
      status: 401,
      code: 'PROVIDER_AUTHENTICATION_FAILED',
      retryable: false,
    },
    {
      status: 403,
      code: 'PROVIDER_AUTHENTICATION_FAILED',
      retryable: false,
    },
    {
      status: 404,
      code: 'PROVIDER_INSTANCE_NOT_FOUND',
      retryable: false,
    },
  ])(
    'mapeia status $status para $code com retryable=$retryable',
    async ({ status, code, retryable }) => {
      fetchMock.mockResolvedValue(response(status, {}));

      await expect(provider.sendText(input)).rejects.toMatchObject({
        code,
        retryable,
        statusCode: status,
      });
    },
  );

  it('mapeia erro de rede sem resposta como retryable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(provider.sendText(input)).rejects.toMatchObject({
      code: 'PROVIDER_NETWORK_ERROR',
      retryable: true,
    });
  });

  it('não inclui API key na mensagem de erro', async () => {
    fetchMock.mockResolvedValue(response(401, {}));

    try {
      await provider.sendText(input);
      throw new Error('Expected provider request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(MessageProviderError);
      expect((error as Error).message).not.toContain('super-secret-api-key');
    }
  });

  it('envia IMAGE para a URL, headers e body confirmados da Evolution v2.3.7', async () => {
    await provider.sendImage(imageInput);

    expect(mediaUrlPolicyMock.assertAllowed).toHaveBeenCalledWith(
      imageInput.mediaUrl,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/message/sendMedia/Ayla%20Flow%2FPrimary',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'super-secret-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          number: '11999999999',
          mediatype: 'image',
          mimetype: 'image/jpeg',
          caption: 'Legenda de teste',
          media: 'https://storage.example.com/campaign/image.jpg',
          fileName: 'campaign.jpg',
        }),
      }),
    );
    expect(configResolverMock.resolve).toHaveBeenCalledWith(
      imageInput.companyId,
    );
  });

  it('envia IMAGE ao celular canônico em uma única requisição', async () => {
    const canonicalPhone = '5545999029181';

    await provider.sendImage({
      ...imageInput,
      recipientPhone: canonicalPhone,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://evolution.example.com/message/sendMedia/Ayla%20Flow%2FPrimary',
    );
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]?.body as string),
    ).toMatchObject({ number: canonicalPhone });
  });

  it('não chama fetch quando a política rejeita a mediaUrl', async () => {
    mediaUrlPolicyMock.assertAllowed.mockImplementation(() => {
      throw new MediaUrlNotAllowedError();
    });

    await expect(provider.sendImage(imageInput)).rejects.toMatchObject({
      message: 'Media URL is not allowed',
      code: 'MEDIA_URL_NOT_ALLOWED',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(configResolverMock.resolve).not.toHaveBeenCalled();
  });

  it('não expõe URL nem hostname quando a política rejeita IMAGE', async () => {
    mediaUrlPolicyMock.assertAllowed.mockImplementation(() => {
      throw new MediaUrlNotAllowedError();
    });

    try {
      await provider.sendImage(imageInput);
      throw new Error('Expected media URL policy to reject');
    } catch (error) {
      expect((error as Error).message).toBe('Media URL is not allowed');
      expect((error as Error).message).not.toContain(imageInput.mediaUrl);
      expect((error as Error).message).not.toContain('storage.example.com');
    }
  });

  it('envia caption vazia quando a legenda da IMAGE está ausente', async () => {
    const { caption: _caption, ...inputWithoutCaption } = imageInput;

    await provider.sendImage(inputWithoutCaption);

    const request = fetchMock.mock.calls[0][1];
    expect(JSON.parse(request?.body as string)).toEqual(
      expect.objectContaining({
        caption: '',
      }),
    );
  });

  it('não envia dados internos da IMAGE no body externo', async () => {
    await provider.sendImage({
      ...imageInput,
      fileSize: 123_456,
      companyId: imageInput.companyId,
      idempotencyKey: imageInput.idempotencyKey,
      customerId: 'customer-1',
      automationId: 'automation-1',
      payload: { internal: true },
    } as SendImageMessageInput);

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(request?.body as string) as Record<string, unknown>;

    expect(Object.keys(body)).toEqual([
      'number',
      'mediatype',
      'mimetype',
      'caption',
      'media',
      'fileName',
    ]);
    expect(body).not.toHaveProperty('fileSize');
    expect(body).not.toHaveProperty('companyId');
    expect(body).not.toHaveProperty('idempotencyKey');
    expect(body).not.toHaveProperty('customerId');
    expect(body).not.toHaveProperty('automationId');
    expect(body).not.toHaveProperty('payload');
  });

  it('codifica instanceName no endpoint de IMAGE', async () => {
    configResolverMock.resolve.mockResolvedValue({
      ...config,
      instanceName: 'Image / São Paulo',
    });

    await provider.sendImage(imageInput);

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://evolution.example.com/message/sendMedia/Image%20%2F%20S%C3%A3o%20Paulo',
    );
  });

  it('retorna providerMessageId para IMAGE', async () => {
    fetchMock.mockResolvedValue(
      response(200, {
        key: { id: 'image-provider-message-1' },
        status: 'PENDING',
      }),
    );

    await expect(provider.sendImage(imageInput)).resolves.toEqual({
      provider: 'EVOLUTION',
      providerMessageId: 'image-provider-message-1',
      rawStatus: 'PENDING',
    });
  });

  it.each([
    [400, 'INVALID_MESSAGE_REQUEST', false],
    [401, 'PROVIDER_AUTHENTICATION_FAILED', false],
    [403, 'PROVIDER_AUTHENTICATION_FAILED', false],
    [404, 'PROVIDER_INSTANCE_NOT_FOUND', false],
    [408, 'PROVIDER_TIMEOUT', true],
    [429, 'PROVIDER_RATE_LIMITED', true],
    [500, 'PROVIDER_UNAVAILABLE', true],
  ] as const)(
    'preserva para IMAGE o mapeamento HTTP %s para %s',
    async (status, code, retryable) => {
      fetchMock.mockResolvedValue(response(status, {}));

      await expect(provider.sendImage(imageInput)).rejects.toMatchObject({
        code,
        retryable,
        statusCode: status,
      });
    },
  );

  it('mapeia erro de rede de IMAGE sem expor a API key', async () => {
    fetchMock.mockRejectedValue(
      new TypeError('fetch failed with super-secret-api-key'),
    );

    try {
      await provider.sendImage(imageInput);
      throw new Error('Expected provider request to fail');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PROVIDER_NETWORK_ERROR',
        retryable: true,
      });
      expect((error as Error).message).not.toContain('super-secret-api-key');
    }
  });

  it('mapeia AbortError no envio de IMAGE como timeout retryable', async () => {
    const abortError = new Error('request aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    await expect(provider.sendImage(imageInput)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      retryable: true,
    });
  });
});
