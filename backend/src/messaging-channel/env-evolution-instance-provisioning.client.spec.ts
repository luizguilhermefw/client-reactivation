import { EvolutionInstanceProvisioningError } from './evolution-instance-provisioning-client.interface';
import { EnvEvolutionInstanceProvisioningClient } from './env-evolution-instance-provisioning.client';

describe('EnvEvolutionInstanceProvisioningClient', () => {
  const environmentKeys = [
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_REQUEST_TIMEOUT_MS',
  ] as const;
  const originalEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  let client: EnvEvolutionInstanceProvisioningClient;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  const response = (status: number, body: unknown): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: jest.fn().mockResolvedValue(body),
    }) as unknown as Response;
  const deviceRemovedDisconnectionObject = JSON.stringify({
    error: {
      data: {
        content: [
          { tag: 'conflict', attrs: { type: 'device_removed' } },
        ],
      },
    },
  });
  const staleDeviceRemovedMetadata = (
    overrides: Record<string, unknown> = {},
  ) => ({
    connectionStatus: 'open',
    number: null,
    disconnectionReasonCode: 401,
    disconnectionObject: deviceRemovedDisconnectionObject,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVOLUTION_API_URL = 'https://evolution.example.test/';
    process.env.EVOLUTION_API_KEY = 'private-api-key';
    process.env.EVOLUTION_REQUEST_TIMEOUT_MS = '4321';
    client = new EnvEvolutionInstanceProvisioningClient();
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(response(200, {}));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    for (const key of environmentKeys) {
      const value = originalEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('creates a Baileys instance using the Evolution API v2.3.7 contract', async () => {
    fetchMock.mockResolvedValueOnce(
      response(201, {
        instance: { status: 'connecting' },
        hash: { apikey: 'provider-generated-secret' },
        qrcode: { base64: 'data:image/png;base64,TEST' },
      }),
    );

    const result = await client.createInstance('ayla_safe123');
    expect(result).toEqual({
      connectionStatus: 'WAITING_QR',
      qrCode: 'data:image/png;base64,TEST',
    });
    expect(JSON.stringify(result)).not.toContain('provider-generated-secret');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.test/instance/create',
      expect.objectContaining({
        method: 'POST',
        headers: {
          apikey: 'private-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instanceName: 'ayla_safe123',
          integration: 'WHATSAPP-BAILEYS',
          qrcode: true,
        }),
      }),
    );
  });

  it('inspects existence through fetchInstances and returns null for an empty result', async () => {
    fetchMock.mockResolvedValueOnce(response(200, []));

    await expect(client.inspectInstance('ayla_safe123')).resolves.toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://evolution.example.test/instance/fetchInstances?instanceName=ayla_safe123',
    );
  });

  it('reads the connected phone from the real fetchInstances number field', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, [
        {
          name: 'ayla_safe123',
          connectionStatus: 'close',
          number: '554591335359',
        },
      ]),
    );

    await expect(client.inspectInstance('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'DISCONNECTED',
      connectedPhone: '554591335359',
    });
  });

  it('preserves fetchInstances number without formatting or canonicalization', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, [
        {
          connectionStatus: 'open',
          number: '+55 (45) 91335-359',
        },
      ]),
    );

    await expect(client.inspectInstance('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'CONNECTED',
      connectedPhone: '+55 (45) 91335-359',
    });
  });

  it('normalizes the real connectionState response', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, { instance: { state: 'open' } }),
    );

    await expect(client.getConnectionState('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'CONNECTED',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://evolution.example.test/instance/connectionState/ayla_safe123',
    );
  });

  it.each([
    ['open', 'CONNECTED'],
    ['close', 'DISCONNECTED'],
  ] as const)(
    'uses connectionState=%s while enriching it with fetchInstances number',
    async (state, expectedStatus) => {
      fetchMock
        .mockResolvedValueOnce(response(200, { instance: { state } }))
        .mockResolvedValueOnce(
          response(200, [
            {
              connectionStatus: state === 'open' ? 'close' : 'open',
              number: '554591335359',
            },
          ]),
        );

      await expect(
        client.getConnectionState('ayla_safe123'),
      ).resolves.toEqual({
        connectionStatus: expectedStatus,
        connectedPhone: '554591335359',
      });
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'https://evolution.example.test/instance/connectionState/ayla_safe123',
        'https://evolution.example.test/instance/fetchInstances?instanceName=ayla_safe123',
      ]);
    },
  );

  it('normalizes stale open device_removed metadata to DISCONNECTED', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(200, { instance: { state: 'open' } }),
      )
      .mockResolvedValueOnce(
        response(200, [
          {
            connectionStatus: 'open',
            number: null,
            ownerJid: '554591335359@s.whatsapp.net',
            disconnectionReasonCode: 401,
            disconnectionObject: JSON.stringify({
              error: {
                data: {
                  content: [
                    {
                      tag: 'conflict',
                      attrs: { type: 'device_removed' },
                    },
                  ],
                },
              },
            }),
          },
        ]),
      );

    await expect(client.getConnectionState('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'DISCONNECTED',
    });
  });

  it('does not infer DISCONNECTED from a missing number alone', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(200, { instance: { state: 'open' } }),
      )
      .mockResolvedValueOnce(
        response(200, [{ connectionStatus: 'open', number: null }]),
      );

    await expect(client.getConnectionState('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'CONNECTED',
    });
  });

  it('keeps CONNECTED when a current number exists despite historical device_removed metadata', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(200, { instance: { state: 'open' } }),
      )
      .mockResolvedValueOnce(
        response(200, [
          {
            connectionStatus: 'open',
            number: '554591335359',
            disconnectionReasonCode: 401,
            disconnectionObject: JSON.stringify({
              conflict: { type: 'device_removed' },
            }),
          },
        ]),
      );

    await expect(client.getConnectionState('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'CONNECTED',
      connectedPhone: '554591335359',
    });
  });

  it.each([
    ['malformed', '{not-json'],
    ['absent', undefined],
  ])(
    'keeps authoritative open when disconnectionObject is %s',
    async (_scenario, disconnectionObject) => {
      fetchMock
        .mockResolvedValueOnce(
          response(200, { instance: { state: 'open' } }),
        )
        .mockResolvedValueOnce(
          response(200, [
            {
              connectionStatus: 'open',
              number: null,
              disconnectionReasonCode: 401,
              ...(disconnectionObject === undefined
                ? {}
                : { disconnectionObject }),
            },
          ]),
        );

      await expect(
        client.getConnectionState('ayla_safe123'),
      ).resolves.toEqual({ connectionStatus: 'CONNECTED' });
    },
  );

  it('requires reason code 401 in addition to structured device_removed', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(200, { instance: { state: 'open' } }),
      )
      .mockResolvedValueOnce(
        response(200, [
          {
            connectionStatus: 'open',
            number: null,
            disconnectionReasonCode: 500,
            disconnectionObject: JSON.stringify({
              conflict: { type: 'device_removed' },
            }),
          },
        ]),
      );

    await expect(client.getConnectionState('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'CONNECTED',
    });
  });

  it('leaves connectedPhone undefined when fetchInstances has no number', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(200, { instance: { state: 'close' } }),
      )
      .mockResolvedValueOnce(
        response(200, [
          {
            connectionStatus: 'close',
            ownerJid: '554591335359@s.whatsapp.net',
          },
        ]),
      );

    await expect(client.getConnectionState('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'DISCONNECTED',
    });
  });

  it('does not invalidate connectionState when complementary metadata fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(200, { instance: { state: 'open' } }),
      )
      .mockRejectedValueOnce(new Error('sensitive metadata failure'));

    await expect(client.getConnectionState('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'CONNECTED',
    });
  });

  it('still fails when the authoritative connectionState request fails', async () => {
    fetchMock.mockRejectedValueOnce(
      new Error('sensitive connection state failure'),
    );

    await expect(
      client.getConnectionState('ayla_safe123'),
    ).rejects.toEqual(new EvolutionInstanceProvisioningError());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not derive connectedPhone from ownerJid alone', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, [
        {
          connectionStatus: 'open',
          ownerJid: '554591335359@s.whatsapp.net',
        },
      ]),
    );

    await expect(client.inspectInstance('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'CONNECTED',
    });
  });

  it('normalizes QR returned directly by instance/connect', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, { code: 'fictional-qr-code', count: 1 }),
    );

    await expect(client.getQrCode('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'WAITING_QR',
      qrCode: 'fictional-qr-code',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://evolution.example.test/instance/connect/ayla_safe123',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers stale device_removed once before returning a QR code', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(200, { instance: { state: 'open' } }),
      )
      .mockResolvedValueOnce(
        response(200, [staleDeviceRemovedMetadata()]),
      )
      .mockResolvedValueOnce(response(200, { message: 'logged out' }))
      .mockResolvedValueOnce(
        response(200, { code: 'fictional-recovered-qr' }),
      );

    await expect(client.getQrCode('ayla_safe123')).resolves.toEqual({
      connectionStatus: 'WAITING_QR',
      qrCode: 'fictional-recovered-qr',
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://evolution.example.test/instance/connect/ayla_safe123',
      'https://evolution.example.test/instance/fetchInstances?instanceName=ayla_safe123',
      'https://evolution.example.test/instance/logout/ayla_safe123',
      'https://evolution.example.test/instance/connect/ayla_safe123',
    ]);
    expect(fetchMock.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        method: 'DELETE',
        headers: { apikey: 'private-api-key' },
      }),
    );
  });

  it('requests and parses a pairing code using the Evolution v2.3.7 endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        pairingCode: '  LG99-3161  ',
        code: 'qr-code-must-not-be-used',
        base64: 'data:image/png;base64,QR_MUST_NOT_BE_USED',
      }),
    );

    await expect(
      client.getPairingCode('LFWeb Studio/2', '5545991335359'),
    ).resolves.toEqual({
      connectionStatus: 'WAITING_QR',
      pairingCode: 'LG99-3161',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.test/instance/connect/LFWeb%20Studio%2F2?number=5545991335359',
      expect.objectContaining({
        method: 'GET',
        headers: { apikey: 'private-api-key' },
      }),
    );
  });

  it('logs out a confirmed stale device_removed instance once and retries pairing once', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(200, { instance: { state: 'open' } }),
      )
      .mockResolvedValueOnce(
        response(200, [
          staleDeviceRemovedMetadata({
            ownerJid: '554591335359@s.whatsapp.net',
          }),
        ]),
      )
      .mockResolvedValueOnce(response(200, { message: 'logged out' }))
      .mockResolvedValueOnce(
        response(200, { pairingCode: 'LG99-3161' }),
      );

    const result = await client.getPairingCode(
      'LFWeb Studio/2',
      '5545991335359',
    );
    expect(result).toEqual({
      connectionStatus: 'WAITING_QR',
      pairingCode: 'LG99-3161',
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://evolution.example.test/instance/connect/LFWeb%20Studio%2F2?number=5545991335359',
      'https://evolution.example.test/instance/fetchInstances?instanceName=LFWeb%20Studio%2F2',
      'https://evolution.example.test/instance/logout/LFWeb%20Studio%2F2',
      'https://evolution.example.test/instance/connect/LFWeb%20Studio%2F2?number=5545991335359',
    ]);
    expect(fetchMock.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        method: 'DELETE',
        headers: { apikey: 'private-api-key' },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('ownerJid');
  });

  it.each([
    [
      'a current number exists',
      staleDeviceRemovedMetadata({ number: '554591335359' }),
    ],
    ['number is absent without other evidence', { connectionStatus: 'open' }],
    [
      'reason code 401 is absent',
      staleDeviceRemovedMetadata({ disconnectionReasonCode: undefined }),
    ],
    [
      'structured device_removed is absent',
      staleDeviceRemovedMetadata({ disconnectionObject: undefined }),
    ],
    [
      'disconnectionObject is malformed',
      staleDeviceRemovedMetadata({ disconnectionObject: '{not-json' }),
    ],
  ])(
    'does not logout when %s',
    async (_scenario, metadata) => {
      fetchMock
        .mockResolvedValueOnce(
          response(200, { instance: { state: 'open' } }),
        )
        .mockResolvedValueOnce(response(200, [metadata]));

      await expect(
        client.getPairingCode('ayla_safe123', '5545991335359'),
      ).rejects.toEqual(new EvolutionInstanceProvisioningError());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/instance/logout/'),
        ),
      ).toBe(false);
    },
  );

  it('fails safely after one recovery when the second pairing response still has no code', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(200, { instance: { state: 'open' } }),
      )
      .mockResolvedValueOnce(
        response(200, [staleDeviceRemovedMetadata()]),
      )
      .mockResolvedValueOnce(response(200, { message: 'logged out' }))
      .mockResolvedValueOnce(
        response(200, { instance: { state: 'open' } }),
      );

    await expect(
      client.getPairingCode('ayla_safe123', '5545991335359'),
    ).rejects.toEqual(new EvolutionInstanceProvisioningError());
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/instance/logout/'),
      ),
    ).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('fails safely without retrying connect when controlled logout fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(200, { instance: { state: 'open' } }),
      )
      .mockResolvedValueOnce(
        response(200, [staleDeviceRemovedMetadata()]),
      )
      .mockResolvedValueOnce(
        response(500, { message: 'sensitive logout detail' }),
      );

    await expect(
      client.getPairingCode('ayla_safe123', '5545991335359'),
    ).rejects.toEqual(new EvolutionInstanceProvisioningError());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('normalizes an explicit pairing response state without changing the code format', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        instance: { state: 'connecting' },
        pairingCode: 'AB12-34CD',
      }),
    );

    await expect(
      client.getPairingCode('ayla_safe123', '5545991335359'),
    ).resolves.toEqual({
      connectionStatus: 'WAITING_QR',
      pairingCode: 'AB12-34CD',
    });
  });

  it('never interprets QR code or base64 fields as a pairing code', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        code: 'fictional-qr-code',
        base64: 'data:image/png;base64,FICTIONAL',
      }),
    );

    await expect(
      client.getPairingCode('ayla_safe123', '5545991335359'),
    ).rejects.toEqual(new EvolutionInstanceProvisioningError());
  });

  it('fails safely for pairing HTTP and network errors without exposing inputs or secrets', async () => {
    fetchMock.mockResolvedValueOnce(
      response(500, { message: 'private-api-key ayla_safe123' }),
    );

    await expect(
      client.getPairingCode('ayla_safe123', '5545991335359'),
    ).rejects.toEqual(new EvolutionInstanceProvisioningError());

    fetchMock.mockRejectedValueOnce(
      new Error('private-api-key ayla_safe123 5545991335359'),
    );
    let receivedError: unknown;
    try {
      await client.getPairingCode('ayla_safe123', '5545991335359');
    } catch (error) {
      receivedError = error;
    }
    expect(receivedError).toEqual(new EvolutionInstanceProvisioningError());
    expect((receivedError as Error).message).not.toMatch(
      /private-api-key|ayla_safe123|5545991335359/,
    );
  });

  it('fails safely on network/provider errors without exposing credentials', async () => {
    fetchMock.mockRejectedValueOnce(new Error('sensitive network detail'));

    let receivedError: unknown;
    try {
      await client.getQrCode('ayla_safe123');
    } catch (error) {
      receivedError = error;
    }

    expect(receivedError).toEqual(new EvolutionInstanceProvisioningError());
    expect(JSON.stringify(fetchMock.mock.calls)).toContain('private-api-key');
    expect((receivedError as Error).message).not.toContain('private-api-key');
  });

  it('fails closed before fetch when provider configuration is absent', async () => {
    delete process.env.EVOLUTION_API_KEY;

    await expect(client.createInstance('ayla_safe123')).rejects.toThrow(
      'Evolution instance configuration is incomplete',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
