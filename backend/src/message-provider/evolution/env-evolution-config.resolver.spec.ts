import { MessageProviderError } from '../contracts/message-provider.types';
import { EnvEvolutionConfigResolver } from './env-evolution-config.resolver';

describe('EnvEvolutionConfigResolver', () => {
  let resolver: EnvEvolutionConfigResolver;

  const configKeys = [
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_INSTANCE_NAME',
    'EVOLUTION_REQUEST_TIMEOUT_MS',
  ] as const;
  const originalConfig = Object.fromEntries(
    configKeys.map((key) => [key, process.env[key]]),
  );

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = 'https://evolution.example.com';
    process.env.EVOLUTION_API_KEY = 'super-secret-api-key';
    process.env.EVOLUTION_INSTANCE_NAME = 'tenant-instance';
    process.env.EVOLUTION_REQUEST_TIMEOUT_MS = '7500';
    resolver = new EnvEvolutionConfigResolver();
  });

  afterAll(() => {
    for (const key of configKeys) {
      const originalValue = originalConfig[key];

      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  it('retorna configuração válida', () => {
    expect(resolver.resolve('company-1')).toEqual({
      apiUrl: 'https://evolution.example.com',
      apiKey: 'super-secret-api-key',
      instanceName: 'tenant-instance',
      timeoutMs: 7_500,
    });
  });

  it('remove barras finais da URL', () => {
    process.env.EVOLUTION_API_URL = 'https://evolution.example.com////';

    expect(resolver.resolve('company-1').apiUrl).toBe(
      'https://evolution.example.com',
    );
  });

  it('usa o timeout configurado', () => {
    process.env.EVOLUTION_REQUEST_TIMEOUT_MS = '2500';

    expect(resolver.resolve('company-1').timeoutMs).toBe(2_500);
  });

  it.each([undefined, '', 'invalid', '0', '-1'])(
    'usa fallback de dez segundos para timeout %s',
    (configuredTimeout) => {
      if (configuredTimeout === undefined) {
        delete process.env.EVOLUTION_REQUEST_TIMEOUT_MS;
      } else {
        process.env.EVOLUTION_REQUEST_TIMEOUT_MS = configuredTimeout;
      }

      expect(resolver.resolve('company-1').timeoutMs).toBe(10_000);
    },
  );

  it('rejeita companyId vazio', () => {
    expect(() => resolver.resolve('   ')).toThrow(
      expect.objectContaining({
        code: 'INVALID_MESSAGE_INPUT',
        retryable: false,
      }),
    );
  });

  it('rejeita configuração incompleta', () => {
    delete process.env.EVOLUTION_INSTANCE_NAME;

    expect(() => resolver.resolve('company-1')).toThrow(
      expect.objectContaining({
        code: 'PROVIDER_CONFIGURATION_ERROR',
        retryable: false,
      }),
    );
  });

  it('não inclui API key na mensagem de erro', () => {
    delete process.env.EVOLUTION_API_URL;

    try {
      resolver.resolve('company-1');
      throw new Error('Expected config resolution to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(MessageProviderError);
      expect((error as Error).message).not.toContain('super-secret-api-key');
    }
  });
});
