import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { EnvMetaCloudConfigResolver } from './env-meta-cloud-config.resolver';

describe('EnvMetaCloudConfigResolver', () => {
  const prisma = { messagingChannel: { findFirst: jest.fn() } };
  const resolver = new EnvMetaCloudConfigResolver(
    prisma as unknown as PrismaService,
  );
  const originalEnv = process.env;
  let secret: string;

  beforeEach(() => {
    jest.resetAllMocks();
    secret = randomBytes(32).toString('hex');
    process.env = {
      ...originalEnv,
      META_WHATSAPP_COMPANY_ID: 'tenant-a',
      META_WHATSAPP_MESSAGING_CHANNEL_ID: 'channel-a',
      META_WHATSAPP_ACCESS_TOKEN: secret,
      META_WHATSAPP_PHONE_NUMBER_ID: '123456',
      META_WHATSAPP_GRAPH_VERSION: 'v99.0',
    };
    delete process.env.META_WHATSAPP_REQUEST_TIMEOUT_MS;
    prisma.messagingChannel.findFirst.mockResolvedValue({ id: 'channel-a' });
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves only the explicitly bound active tenant/channel', async () => {
    const config = await resolver.resolve(' tenant-a ', ' channel-a ');
    expect(config.timeoutMs).toBe(10_000);
    expect(config.phoneNumberId).toBe('123456');
    expect(prisma.messagingChannel.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'channel-a',
        companyId: 'tenant-a',
        provider: 'META_CLOUD',
        status: 'ACTIVE',
      },
      select: { id: true },
    });
  });

  it.each([
    ['tenant-b', 'channel-a'],
    ['tenant-a', 'channel-b'],
  ])(
    'never shares env credentials with %s / %s',
    async (companyId, channelId) => {
      await expect(
        resolver.resolve(companyId, channelId),
      ).rejects.toMatchObject({
        code: 'PROVIDER_CONFIGURATION_ERROR',
        retryable: false,
      });
      expect(prisma.messagingChannel.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([
    'META_WHATSAPP_COMPANY_ID',
    'META_WHATSAPP_MESSAGING_CHANNEL_ID',
    'META_WHATSAPP_ACCESS_TOKEN',
    'META_WHATSAPP_PHONE_NUMBER_ID',
    'META_WHATSAPP_GRAPH_VERSION',
  ])('fails closed when %s is absent', async (key) => {
    delete process.env[key];
    await expect(
      resolver.resolve('tenant-a', 'channel-a'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
    expect(prisma.messagingChannel.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['META_WHATSAPP_PHONE_NUMBER_ID', '../other'],
    ['META_WHATSAPP_GRAPH_VERSION', 'https://invalid.example'],
    ['META_WHATSAPP_REQUEST_TIMEOUT_MS', '0'],
    ['META_WHATSAPP_REQUEST_TIMEOUT_MS', 'NaN'],
    ['META_WHATSAPP_REQUEST_TIMEOUT_MS', '120001'],
  ])('rejects invalid %s', async (key, value) => {
    process.env[key] = value;
    await expect(
      resolver.resolve('tenant-a', 'channel-a'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
  });

  it('rejects a missing, inactive or non-Meta channel', async () => {
    prisma.messagingChannel.findFirst.mockResolvedValue(null);
    await expect(
      resolver.resolve('tenant-a', 'channel-a'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
  });

  it('sanitizes database errors and marks them retryable', async () => {
    prisma.messagingChannel.findFirst.mockRejectedValue(
      new Error(`private database detail ${secret}`),
    );
    const error: unknown = await resolver
      .resolve('tenant-a', 'channel-a')
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
    expect(String(error).includes(secret)).toBe(false);
    expect(String(error)).not.toContain('private database detail');
  });

  it.each([null, 1, '', {}])(
    'rejects malformed context %# safely',
    async (value) => {
      await expect(
        resolver.resolve(value as string, 'channel-a'),
      ).rejects.toMatchObject({
        code: 'INVALID_MESSAGE_INPUT',
        retryable: false,
      });
    },
  );
});
