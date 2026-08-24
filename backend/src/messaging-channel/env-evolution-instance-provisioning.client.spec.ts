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
