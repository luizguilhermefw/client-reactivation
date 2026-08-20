import {
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EVOLUTION_WEBHOOK_SECRET_HEADER } from '../webhook/evolution-webhook-secret.guard';
import type {
  EvolutionWebhookProvisioningConfig,
  EvolutionWebhookProvisioningConfigResolver,
} from './evolution-webhook-provisioning-config.interface';
import {
  EVOLUTION_MESSAGES_UPSERT_EVENT,
  EvolutionWebhookProvisioningService,
} from './evolution-webhook-provisioning.service';

describe('EvolutionWebhookProvisioningService', () => {
  let service: EvolutionWebhookProvisioningService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  const config: EvolutionWebhookProvisioningConfig = {
    apiUrl: 'https://evolution.example.test',
    apiKey: 'private-api-key',
    instanceName: 'Ayla Flow/Primary',
    timeoutMs: 5_000,
    publicUrl: 'http://backend.example.test/webhooks/evolution/messages',
    secret: 'private-webhook-secret',
  };
  const configResolverMock: jest.Mocked<EvolutionWebhookProvisioningConfigResolver> =
    {
      resolve: jest.fn(),
    };

  const response = (status: number, body: unknown = {}): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: jest.fn().mockResolvedValue(body),
    }) as unknown as Response;

  const expectedWebhook = () => ({
    enabled: true,
    url: config.publicUrl,
    events: [EVOLUTION_MESSAGES_UPSERT_EVENT],
    headers: {
      [EVOLUTION_WEBHOOK_SECRET_HEADER]: config.secret,
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    configResolverMock.resolve.mockResolvedValue(config);
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(response(200, expectedWebhook()));
    service = new EvolutionWebhookProvisioningService(configResolverMock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('configura webhook ausente com o body da Evolution API v2.3.7', async () => {
    fetchMock
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200));

    await expect(service.ensureConfigured('company-1')).resolves.toEqual({
      instanceName: config.instanceName,
      configured: true,
      changed: true,
      url: config.publicUrl,
      events: [EVOLUTION_MESSAGES_UPSERT_EVENT],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://evolution.example.test/webhook/find/Ayla%20Flow%2FPrimary',
      expect.objectContaining({
        method: 'GET',
        headers: { apikey: config.apiKey },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://evolution.example.test/webhook/set/Ayla%20Flow%2FPrimary',
      expect.objectContaining({
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
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://evolution.example.test/webhook/find/Ayla%20Flow%2FPrimary',
      expect.objectContaining({
        method: 'GET',
        headers: { apikey: config.apiKey },
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('é idempotente e não faz POST quando o webhook já está correto', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        webhook: {
          ...expectedWebhook(),
          headers: {
            'X-AylaFlow-Webhook-Secret': config.secret,
          },
        },
      }),
    );

    await expect(service.ensureConfigured('company-1')).resolves.toEqual({
      instanceName: config.instanceName,
      configured: true,
      changed: false,
      url: config.publicUrl,
      events: [EVOLUTION_MESSAGES_UPSERT_EVENT],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it.each([
    ['URL divergente', { url: 'https://different.example.test/webhook' }],
    ['webhook desabilitado', { enabled: false }],
    ['evento ausente', { events: ['CONNECTION_UPDATE'] }],
    [
      'secret divergente',
      { headers: { [EVOLUTION_WEBHOOK_SECRET_HEADER]: 'different' } },
    ],
  ])('reconcilia %s', async (_scenario, difference) => {
    fetchMock
      .mockResolvedValueOnce(
        response(200, { ...expectedWebhook(), ...difference }),
      )
      .mockResolvedValueOnce(response(200));

    await expect(service.ensureConfigured('company-1')).resolves.toEqual(
      expect.objectContaining({ configured: true, changed: true }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[2][1]?.method).toBe('GET');
  });

  it.each([
    ['null', null],
    ['payload inválido', 'invalid-payload'],
    [
      'configuração divergente',
      { ...expectedWebhook(), events: ['CONNECTION_UPDATE'] },
    ],
  ])(
    'falha de forma fechada quando a confirmação pós-POST retorna %s',
    async (_scenario, confirmation) => {
      fetchMock
        .mockResolvedValueOnce(response(404))
        .mockResolvedValueOnce(response(200))
        .mockResolvedValueOnce(response(200, confirmation));

      await expect(service.ensureConfigured('company-1')).rejects.toEqual(
        new ServiceUnavailableException(
          'Evolution webhook configuration could not be confirmed',
        ),
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
        'GET',
        'POST',
        'GET',
      ]);
    },
  );

  it('falha de forma fechada quando o GET de confirmação falha', async () => {
    fetchMock
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(500));

    await expect(service.ensureConfigured('company-1')).rejects.toEqual(
      new ServiceUnavailableException(
        'Evolution webhook configuration could not be confirmed',
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['HTTP externo', () => Promise.resolve(response(500))],
    ['rede', () => Promise.reject(new Error('sensitive network detail'))],
  ])('trata falha de GET (%s) com erro seguro', async (_scenario, result) => {
    fetchMock.mockImplementationOnce(result as never);

    await expect(service.ensureConfigured('company-1')).rejects.toEqual(
      new ServiceUnavailableException(
        'Evolution webhook configuration could not be inspected',
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['HTTP externo', () => Promise.resolve(response(500))],
    ['rede', () => Promise.reject(new Error('sensitive network detail'))],
  ])('trata falha de POST (%s) com erro seguro', async (_scenario, result) => {
    fetchMock
      .mockResolvedValueOnce(response(404))
      .mockImplementationOnce(result as never);

    await expect(service.ensureConfigured('company-1')).rejects.toEqual(
      new ServiceUnavailableException(
        'Evolution webhook configuration could not be updated',
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falha antes do HTTP quando a configuração está ausente', async () => {
    configResolverMock.resolve.mockRejectedValue(
      new InternalServerErrorException(
        'Evolution webhook configuration is incomplete',
      ),
    );

    await expect(service.ensureConfigured('company-1')).rejects.toThrow(
      'Evolution webhook configuration is incomplete',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('não retorna nem registra API key ou webhook secret', async () => {
    const logSpies = [
      jest.spyOn(console, 'log').mockImplementation(),
      jest.spyOn(console, 'warn').mockImplementation(),
      jest.spyOn(console, 'error').mockImplementation(),
    ];

    const result = await service.ensureConfigured('company-1');
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain(config.apiKey);
    expect(serializedResult).not.toContain(config.secret);
    expect(logSpies.flatMap((spy) => spy.mock.calls).join(' ')).not.toContain(
      config.secret,
    );
  });

  it('resolve configuração usando somente o companyId confiável', async () => {
    await service.ensureConfigured('company-from-jwt');
    expect(configResolverMock.resolve).toHaveBeenCalledWith('company-from-jwt');
  });

  it('uses the instance resolved from the company MessagingChannel', async () => {
    configResolverMock.resolve.mockResolvedValue({
      ...config,
      instanceName: 'company-b-instance',
    });

    await service.ensureConfigured('company-b');

    expect(configResolverMock.resolve).toHaveBeenCalledWith('company-b');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://evolution.example.test/webhook/find/company-b-instance',
    );
  });
});
