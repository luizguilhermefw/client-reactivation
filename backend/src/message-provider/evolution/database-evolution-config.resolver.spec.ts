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
    prismaMock.messagingChannel.findMany.mockResolvedValue([
      { instanceName: 'company-instance' },
    ]);
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
    'resolves %s to its own ACTIVE EVOLUTION channel',
    async (companyId, instanceName) => {
      prismaMock.messagingChannel.findMany.mockResolvedValue([
        { instanceName },
      ]);

      await expect(resolver.resolve(companyId)).resolves.toEqual({
        apiUrl: 'https://evolution.example.test',
        apiKey: 'private-api-key',
        instanceName,
        timeoutMs: 7_500,
      });
      expect(prismaMock.messagingChannel.findMany).toHaveBeenCalledWith({
        where: {
          companyId,
          provider: MessagingProvider.EVOLUTION,
          status: MessagingChannelStatus.ACTIVE,
        },
        take: 2,
        select: { instanceName: true },
      });
    },
  );

  it.each([
    ['without a channel'],
    ['with only an INACTIVE channel'],
    ['with only another provider'],
  ])('fails closed for a company %s', async () => {
    prismaMock.messagingChannel.findMany.mockResolvedValue([]);

    await expect(resolver.resolve('company-1')).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
    expect(prismaMock.messagingChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          provider: MessagingProvider.EVOLUTION,
          status: MessagingChannelStatus.ACTIVE,
        },
      }),
    );
  });

  it('fails closed when two ACTIVE EVOLUTION channels exist for the company', async () => {
    prismaMock.messagingChannel.findMany.mockResolvedValue([
      { instanceName: 'instance-a' },
      { instanceName: 'instance-b' },
    ]);

    await expect(resolver.resolve('company-1')).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
  });

  it('does not fall back to EVOLUTION_INSTANCE_NAME', async () => {
    prismaMock.messagingChannel.findMany.mockResolvedValue([]);

    await expect(resolver.resolve('company-1')).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
  });

  it('maps database lookup failures to a safe retryable provider error', async () => {
    const sensitiveDetail = 'sensitive database connection detail';
    prismaMock.messagingChannel.findMany.mockRejectedValue(
      new Error(sensitiveDetail),
    );

    await expect(resolver.resolve('company-1')).rejects.toEqual(
      expect.objectContaining({
        message:
          'Message provider channel resolution is temporarily unavailable',
        code: 'PROVIDER_UNAVAILABLE',
        retryable: true,
      }),
    );

    try {
      await resolver.resolve('company-1');
      throw new Error('Expected channel resolution to fail');
    } catch (error) {
      expect((error as Error).message).not.toContain(sensitiveDetail);
    }
  });

  it('keeps a missing channel as a non-retryable configuration error', async () => {
    prismaMock.messagingChannel.findMany.mockResolvedValue([]);

    await expect(resolver.resolve('company-1')).rejects.toMatchObject({
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

      await expect(resolver.resolve('company-1')).resolves.toMatchObject({
        timeoutMs: 10_000,
      });
    },
  );

  it('rejects an empty companyId before querying Prisma', async () => {
    await expect(resolver.resolve('   ')).rejects.toMatchObject({
      code: 'INVALID_MESSAGE_INPUT',
      retryable: false,
    });
    expect(prismaMock.messagingChannel.findMany).not.toHaveBeenCalled();
  });

  it.each(['EVOLUTION_API_URL', 'EVOLUTION_API_KEY'] as const)(
    'rejects incomplete shared configuration when %s is absent',
    async (key) => {
      delete process.env[key];

      await expect(resolver.resolve('company-1')).rejects.toMatchObject({
        code: 'PROVIDER_CONFIGURATION_ERROR',
        retryable: false,
      });
      expect(prismaMock.messagingChannel.findMany).not.toHaveBeenCalled();
    },
  );

  it('does not expose the API key or channel details in errors', async () => {
    prismaMock.messagingChannel.findMany.mockResolvedValue([
      { instanceName: 'first-sensitive-instance' },
      { instanceName: 'second-sensitive-instance' },
    ]);

    try {
      await resolver.resolve('company-1');
      throw new Error('Expected config resolution to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(MessageProviderError);
      expect((error as Error).message).not.toContain('private-api-key');
      expect((error as Error).message).not.toContain('sensitive-instance');
    }
  });
});
