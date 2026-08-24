import { InternalServerErrorException } from '@nestjs/common';
import { MessagingChannelStatus, MessagingProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EnvEvolutionWebhookProvisioningConfigResolver } from './env-evolution-webhook-provisioning-config.resolver';

describe('EnvEvolutionWebhookProvisioningConfigResolver', () => {
  const configKeys = [
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_REQUEST_TIMEOUT_MS',
    'EVOLUTION_WEBHOOK_PUBLIC_URL',
    'EVOLUTION_WEBHOOK_SECRET',
  ] as const;
  const webhookConfigKeys = [
    'EVOLUTION_WEBHOOK_PUBLIC_URL',
    'EVOLUTION_WEBHOOK_SECRET',
  ] as const;
  const originalConfig = Object.fromEntries(
    configKeys.map((key) => [key, process.env[key]]),
  );
  const prismaMock = {
    messagingChannel: {
      findMany: jest.fn(),
    },
  };
  let resolver: EnvEvolutionWebhookProvisioningConfigResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVOLUTION_WEBHOOK_PUBLIC_URL =
      'http://backend.example.test/webhooks/evolution/messages';
    process.env.EVOLUTION_WEBHOOK_SECRET = 'private-webhook-secret';
    process.env.EVOLUTION_API_URL = 'https://evolution.example.test/';
    process.env.EVOLUTION_API_KEY = 'private-api-key';
    process.env.EVOLUTION_REQUEST_TIMEOUT_MS = '4500';
    prismaMock.messagingChannel.findMany.mockResolvedValue([
      { instanceName: 'company-instance' },
    ]);
    resolver = new EnvEvolutionWebhookProvisioningConfigResolver(
      prismaMock as unknown as PrismaService,
    );
  });

  afterAll(() => {
    for (const key of configKeys) {
      const originalValue = originalConfig[key];
      if (originalValue === undefined) delete process.env[key];
      else process.env[key] = originalValue;
    }
  });

  it('composes the tenant channel config with webhook URL and secret', async () => {
    await expect(resolver.resolve('company-1')).resolves.toEqual({
      apiUrl: 'https://evolution.example.test',
      apiKey: 'private-api-key',
      instanceName: 'company-instance',
      timeoutMs: 4_500,
      publicUrl: 'http://backend.example.test/webhooks/evolution/messages',
      secret: 'private-webhook-secret',
    });
    expect(prismaMock.messagingChannel.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        provider: MessagingProvider.EVOLUTION,
        status: MessagingChannelStatus.ACTIVE,
      },
      take: 2,
      select: { instanceName: true },
    });
  });

  it('resolves a specific provisioning instance without active-channel lookup', async () => {
    await expect(
      resolver.resolveForInstance('company-1', ' inactive-instance '),
    ).resolves.toEqual({
      apiUrl: 'https://evolution.example.test',
      apiKey: 'private-api-key',
      instanceName: 'inactive-instance',
      timeoutMs: 4_500,
      publicUrl: 'http://backend.example.test/webhooks/evolution/messages',
      secret: 'private-webhook-secret',
    });
    expect(prismaMock.messagingChannel.findMany).not.toHaveBeenCalled();
  });

  it.each(webhookConfigKeys)('fails closed when %s is absent', async (key) => {
    delete process.env[key];

    await expect(resolver.resolve('company-1')).rejects.toEqual(
      new InternalServerErrorException(
        'Evolution webhook configuration is incomplete',
      ),
    );
  });

  it.each([
    'not-a-url',
    'ftp://backend.example.test/webhook',
    'https://user:password@backend.example.test/webhook',
  ])(
    'rejects an invalid EVOLUTION_WEBHOOK_PUBLIC_URL: %s',
    async (publicUrl) => {
      process.env.EVOLUTION_WEBHOOK_PUBLIC_URL = publicUrl;

      await expect(resolver.resolve('company-1')).rejects.toThrow(
        'Evolution webhook configuration is incomplete',
      );
    },
  );

  it('maps provider channel resolution failures to a safe error', async () => {
    prismaMock.messagingChannel.findMany.mockRejectedValue(
      new Error('sensitive database or channel detail'),
    );

    await expect(resolver.resolve('company-1')).rejects.toEqual(
      new InternalServerErrorException(
        'Evolution webhook configuration is incomplete',
      ),
    );
  });

  it('does not expose API key or webhook secret in configuration errors', async () => {
    process.env.EVOLUTION_WEBHOOK_PUBLIC_URL = 'invalid';

    try {
      await resolver.resolve('company-1');
      throw new Error('Expected configuration resolution to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as Error).message).not.toContain('private-api-key');
      expect((error as Error).message).not.toContain('private-webhook-secret');
    }
  });
});
