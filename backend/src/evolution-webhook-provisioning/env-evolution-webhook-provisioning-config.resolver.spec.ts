import { InternalServerErrorException } from '@nestjs/common';
import { EnvEvolutionConfigResolver } from '../message-provider/evolution/env-evolution-config.resolver';
import { EnvEvolutionWebhookProvisioningConfigResolver } from './env-evolution-webhook-provisioning-config.resolver';

describe('EnvEvolutionWebhookProvisioningConfigResolver', () => {
  const configKeys = [
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_INSTANCE_NAME',
    'EVOLUTION_REQUEST_TIMEOUT_MS',
    'EVOLUTION_WEBHOOK_PUBLIC_URL',
    'EVOLUTION_WEBHOOK_SECRET',
  ] as const;
  const originalConfig = Object.fromEntries(
    configKeys.map((key) => [key, process.env[key]]),
  );
  let resolver: EnvEvolutionWebhookProvisioningConfigResolver;

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = 'https://evolution.example.test/';
    process.env.EVOLUTION_API_KEY = 'private-api-key';
    process.env.EVOLUTION_INSTANCE_NAME = 'instance-1';
    process.env.EVOLUTION_REQUEST_TIMEOUT_MS = '4500';
    process.env.EVOLUTION_WEBHOOK_PUBLIC_URL =
      'http://backend.example.test/webhooks/evolution/messages';
    process.env.EVOLUTION_WEBHOOK_SECRET = 'private-webhook-secret';
    resolver = new EnvEvolutionWebhookProvisioningConfigResolver(
      new EnvEvolutionConfigResolver(),
    );
  });

  afterAll(() => {
    for (const key of configKeys) {
      const originalValue = originalConfig[key];
      if (originalValue === undefined) delete process.env[key];
      else process.env[key] = originalValue;
    }
  });

  it('compõe configuração tenant-aware do provider com URL e secret do webhook', () => {
    expect(resolver.resolve('company-1')).toEqual({
      apiUrl: 'https://evolution.example.test',
      apiKey: 'private-api-key',
      instanceName: 'instance-1',
      timeoutMs: 4_500,
      publicUrl: 'http://backend.example.test/webhooks/evolution/messages',
      secret: 'private-webhook-secret',
    });
  });

  it.each([
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_INSTANCE_NAME',
    'EVOLUTION_WEBHOOK_PUBLIC_URL',
    'EVOLUTION_WEBHOOK_SECRET',
  ] as const)('falha de forma fechada quando %s está ausente', (key) => {
    delete process.env[key];

    expect(() => resolver.resolve('company-1')).toThrow(
      new InternalServerErrorException(
        'Evolution webhook configuration is incomplete',
      ),
    );
  });

  it.each([
    'not-a-url',
    'ftp://backend.example.test/webhook',
    'https://user:password@backend.example.test/webhook',
  ])('rejeita EVOLUTION_WEBHOOK_PUBLIC_URL inválida: %s', (publicUrl) => {
    process.env.EVOLUTION_WEBHOOK_PUBLIC_URL = publicUrl;
    expect(() => resolver.resolve('company-1')).toThrow(
      'Evolution webhook configuration is incomplete',
    );
  });

  it('não expõe API key nem secret no erro de configuração', () => {
    process.env.EVOLUTION_WEBHOOK_PUBLIC_URL = 'invalid';

    try {
      resolver.resolve('company-1');
      throw new Error('Expected configuration resolution to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as Error).message).not.toContain('private-api-key');
      expect((error as Error).message).not.toContain('private-webhook-secret');
    }
  });

  it('rejeita companyId vazio sem expor detalhes do resolver interno', () => {
    expect(() => resolver.resolve('  ')).toThrow(
      'Evolution webhook configuration is incomplete',
    );
  });
});
