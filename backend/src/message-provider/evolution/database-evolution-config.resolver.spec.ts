import { MessagingChannelStatus, MessagingProvider } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MessageProviderError } from '../contracts/message-provider.types';
import { DatabaseEvolutionConfigResolver } from './database-evolution-config.resolver';

describe('DatabaseEvolutionConfigResolver', () => {
  const configKeys = [
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_INSTANCE_NAME',
    'EVOLUTION_REQUEST_TIMEOUT_MS',
  ] as const;
  const originalConfig = Object.fromEntries(
    configKeys.map((key) => [key, process.env[key]]),
  );
  const prismaMock = {
    messagingChannel: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
  let resolver: DatabaseEvolutionConfigResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVOLUTION_API_URL = 'https://evolution.example.test////';
    process.env.EVOLUTION_API_KEY = 'private-api-key';
    process.env.EVOLUTION_INSTANCE_NAME = 'global-instance-must-be-ignored';
    process.env.EVOLUTION_REQUEST_TIMEOUT_MS = '7500';
    prismaMock.messagingChannel.findFirst.mockResolvedValue({
      instanceName: 'company-instance',
    });
    resolver = new DatabaseEvolutionConfigResolver(
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

  it.each([
    ['company-a', 'instance-a'],
    ['company-b', 'instance-b'],
  ])(
    'resolves %s through the exact pinned EVOLUTION channel',
    async (companyId, instanceName) => {
      prismaMock.messagingChannel.findFirst.mockResolvedValue({ instanceName });

      await expect(resolver.resolve(companyId, 'channel-1')).resolves.toEqual({
        apiUrl: 'https://evolution.example.test',
        apiKey: 'private-api-key',
        instanceName,
        timeoutMs: 7_500,
      });
      expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'channel-1',
          companyId,
          provider: MessagingProvider.EVOLUTION,
          status: MessagingChannelStatus.ACTIVE,
        },
        select: { instanceName: true },
      });
    },
  );

  it('fails closed when the pinned channel is absent or tenant/provider mismatched', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

    await expect(resolver.resolve('company-1', 'channel-1')).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'channel-1',
          companyId: 'company-1',
          provider: MessagingProvider.EVOLUTION,
          status: MessagingChannelStatus.ACTIVE,
        },
      }),
    );
  });

  it('does not fall back to EVOLUTION_INSTANCE_NAME', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

    await expect(resolver.resolve('company-1', 'channel-1')).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
  });

  it('fails closed when the exact pinned channel is INACTIVE', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

    await expect(
      resolver.resolve('company-1', 'inactive-channel'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'inactive-channel',
        companyId: 'company-1',
        provider: MessagingProvider.EVOLUTION,
        status: MessagingChannelStatus.ACTIVE,
      },
      select: { instanceName: true },
    });
  });

  it('fails closed for a pinned channel from another tenant', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

    await expect(
      resolver.resolve('company-1', 'other-tenant-channel'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
  });

  it('fails closed for a pinned channel from another provider', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

    await expect(
      resolver.resolve('company-1', 'other-provider-channel'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: MessagingProvider.EVOLUTION,
        }),
      }),
    );
  });

  it('resolves the exact pinned ID without ambiguity when other ACTIVE channels exist', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue({
      instanceName: 'pinned-instance',
    });
    prismaMock.messagingChannel.findMany.mockResolvedValue([
      { instanceName: 'other-active-instance-a' },
      { instanceName: 'other-active-instance-b' },
    ]);

    await expect(
      resolver.resolve('company-1', 'channel-pinned'),
    ).resolves.toMatchObject({ instanceName: 'pinned-instance' });

    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'channel-pinned',
        companyId: 'company-1',
        provider: MessagingProvider.EVOLUTION,
        status: MessagingChannelStatus.ACTIVE,
      },
      select: { instanceName: true },
    });
    expect(prismaMock.messagingChannel.findMany).not.toHaveBeenCalled();
  });

  it('does not fall back when the pinned channel is INACTIVE and another is ACTIVE', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);
    prismaMock.messagingChannel.findMany.mockResolvedValue([
      { instanceName: 'other-active-instance' },
    ]);

    await expect(
      resolver.resolve('company-1', 'inactive-pinned-channel'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.messagingChannel.findMany).not.toHaveBeenCalled();
  });

  it('does not use connectionStatus as outbound routing authorization', async () => {
    await resolver.resolve('company-1', 'channel-1');

    const where = prismaMock.messagingChannel.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: MessagingChannelStatus.ACTIVE });
    expect(where).not.toHaveProperty('connectionStatus');
  });

  it('rejects an empty messagingChannelId before querying Prisma', async () => {
    await expect(resolver.resolve('company-1', '   ')).rejects.toMatchObject({
      code: 'INVALID_MESSAGE_INPUT',
      retryable: false,
    });
    expect(prismaMock.messagingChannel.findFirst).not.toHaveBeenCalled();
  });

  it('maps database lookup failures to a safe retryable provider error', async () => {
    const sensitiveDetail = 'sensitive database connection detail';
    prismaMock.messagingChannel.findFirst.mockRejectedValue(
      new Error(sensitiveDetail),
    );

    await expect(resolver.resolve('company-1', 'channel-1')).rejects.toEqual(
      expect.objectContaining({
        message:
          'Message provider channel resolution is temporarily unavailable',
        code: 'PROVIDER_UNAVAILABLE',
        retryable: true,
      }),
    );

    try {
      await resolver.resolve('company-1', 'channel-1');
      throw new Error('Expected channel resolution to fail');
    } catch (error) {
      expect((error as Error).message).not.toContain(sensitiveDetail);
    }
  });

  it('keeps a missing channel as a non-retryable configuration error', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

    await expect(resolver.resolve('company-1', 'channel-1')).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
  });

  it.each([undefined, '', 'invalid', '0', '-1'])(
    'uses the ten-second fallback for timeout %s',
    async (configuredTimeout) => {
      if (configuredTimeout === undefined) {
        delete process.env.EVOLUTION_REQUEST_TIMEOUT_MS;
      } else {
        process.env.EVOLUTION_REQUEST_TIMEOUT_MS = configuredTimeout;
      }

      await expect(resolver.resolve('company-1', 'channel-1')).resolves.toMatchObject({
        timeoutMs: 10_000,
      });
    },
  );

  it('rejects an empty companyId before querying Prisma', async () => {
    await expect(resolver.resolve('   ', 'channel-1')).rejects.toMatchObject({
      code: 'INVALID_MESSAGE_INPUT',
      retryable: false,
    });
    expect(prismaMock.messagingChannel.findFirst).not.toHaveBeenCalled();
  });

  it.each(['EVOLUTION_API_URL', 'EVOLUTION_API_KEY'] as const)(
    'rejects incomplete shared configuration when %s is absent',
    async (key) => {
      delete process.env[key];

      await expect(resolver.resolve('company-1', 'channel-1')).rejects.toMatchObject({
        code: 'PROVIDER_CONFIGURATION_ERROR',
        retryable: false,
      });
      expect(prismaMock.messagingChannel.findFirst).not.toHaveBeenCalled();
    },
  );

  it('does not expose the API key or channel details in errors', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue({
      instanceName: 'sensitive-instance',
    });

    delete process.env.EVOLUTION_API_KEY;

    try {
      await resolver.resolve('company-1', 'channel-1');
      throw new Error('Expected config resolution to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(MessageProviderError);
      expect((error as Error).message).not.toContain('private-api-key');
      expect((error as Error).message).not.toContain('sensitive-instance');
    }
  });
});
