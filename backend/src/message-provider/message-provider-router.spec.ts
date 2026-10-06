import { PrismaService } from '../../prisma/prisma.service';
import type { MessageProvider } from './contracts/message-provider.interface';
import {
  MessageProviderError,
  SendTemplateMessageInput,
} from './contracts/message-provider.types';
import { EvolutionMessageProvider } from './evolution/evolution-message.provider';
import { MetaCloudMessageProvider } from './meta-cloud/meta-cloud-message.provider';
import { MessageProviderRouter } from './message-provider-router';

describe('MessageProviderRouter', () => {
  const prisma = {
    messagingChannel: { findFirst: jest.fn(), findMany: jest.fn() },
  };
  const evolution: jest.Mocked<MessageProvider> = {
    sendText: jest.fn(),
    sendImage: jest.fn(),
    sendTemplate: jest.fn(),
  };
  const meta: jest.Mocked<MessageProvider> = {
    sendText: jest.fn(),
    sendImage: jest.fn(),
    sendTemplate: jest.fn(),
  };
  const router = new MessageProviderRouter(
    prisma as unknown as PrismaService,
    evolution as unknown as EvolutionMessageProvider,
    meta as unknown as MetaCloudMessageProvider,
  );
  const base = {
    companyId: 'tenant-a',
    messagingChannelId: 'channel-a',
    recipientPhone: '5545999999999',
    idempotencyKey: 'key',
  };
  const template: SendTemplateMessageInput = {
    ...base,
    type: 'TEMPLATE',
    templateName: 'hello_world',
    languageCode: 'en_US',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.messagingChannel.findFirst.mockResolvedValue({
      provider: 'EVOLUTION',
    });
    evolution.sendText.mockResolvedValue({
      provider: 'EVOLUTION',
      providerMessageId: 'text-id',
    });
    evolution.sendImage.mockResolvedValue({
      provider: 'EVOLUTION',
      providerMessageId: 'image-id',
    });
    meta.sendTemplate.mockResolvedValue({
      provider: 'META_CLOUD',
      providerMessageId: 'template-id',
    });
  });

  it('forwards Evolution TEXT unchanged and authorizes only the exact active tenant channel', async () => {
    const input = { ...base, content: 'text' };
    await expect(router.sendText(input)).resolves.toEqual({
      provider: 'EVOLUTION',
      providerMessageId: 'text-id',
    });
    expect(evolution.sendText).toHaveBeenCalledWith(input);
    expect(prisma.messagingChannel.findFirst).toHaveBeenCalledWith({
      where: { id: 'channel-a', companyId: 'tenant-a', status: 'ACTIVE' },
      select: { provider: true },
    });
    expect(meta.sendText).not.toHaveBeenCalled();
    expect(prisma.messagingChannel.findMany).not.toHaveBeenCalled();
  });

  it('forwards Evolution IMAGE unchanged', async () => {
    const input = {
      ...base,
      mediaUrl: 'https://example.test/image.png',
      mimeType: 'image/png' as const,
      fileName: 'image.png',
    };
    await router.sendImage(input);
    expect(evolution.sendImage).toHaveBeenCalledWith(input);
    expect(meta.sendImage).not.toHaveBeenCalled();
  });

  it('forwards TEMPLATE exclusively to the provider selected by the database', async () => {
    prisma.messagingChannel.findFirst.mockResolvedValue({
      provider: 'META_CLOUD',
    });
    await expect(router.sendTemplate(template)).resolves.toEqual({
      provider: 'META_CLOUD',
      providerMessageId: 'template-id',
    });
    expect(meta.sendTemplate).toHaveBeenCalledWith(template);
    expect(evolution.sendTemplate).not.toHaveBeenCalled();
  });

  it.each([
    {
      id: 'channel-a',
      companyId: 'tenant-b',
      status: 'ACTIVE',
      provider: 'META_CLOUD',
    },
    {
      id: 'channel-a',
      companyId: 'tenant-a',
      status: 'INACTIVE',
      provider: 'EVOLUTION',
    },
    {
      id: 'channel-b',
      companyId: 'tenant-a',
      status: 'ACTIVE',
      provider: 'EVOLUTION',
    },
  ])(
    'fails closed for a mismatched or inactive pinned channel %# without fallback',
    async (record) => {
      prisma.messagingChannel.findFirst.mockImplementation(
        ({
          where,
        }: {
          where: { id: string; companyId: string; status: string };
        }) =>
          Promise.resolve(
            record.id === where.id &&
              record.companyId === where.companyId &&
              record.status === where.status
              ? record
              : null,
          ),
      );
      await expect(router.sendTemplate(template)).rejects.toMatchObject({
        code: 'PROVIDER_CONFIGURATION_ERROR',
        retryable: false,
      });
      expect(evolution.sendTemplate).not.toHaveBeenCalled();
      expect(meta.sendTemplate).not.toHaveBeenCalled();
      expect(prisma.messagingChannel.findMany).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown providers without fallback', async () => {
    prisma.messagingChannel.findFirst.mockResolvedValue({
      provider: 'UNKNOWN_PROVIDER',
    });
    await expect(router.sendTemplate(template)).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION_ERROR',
      retryable: false,
    });
    expect(meta.sendTemplate).not.toHaveBeenCalled();
  });

  it('propagates unsupported type errors without selecting another provider', async () => {
    prisma.messagingChannel.findFirst.mockResolvedValue({
      provider: 'META_CLOUD',
    });
    meta.sendText.mockRejectedValue(
      new MessageProviderError(
        'Message type is not supported by this provider',
        { code: 'UNSUPPORTED_MESSAGE_TYPE', retryable: false },
      ),
    );
    await expect(
      router.sendText({ ...base, content: 'text' }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_MESSAGE_TYPE',
      retryable: false,
    });
    expect(evolution.sendText).not.toHaveBeenCalled();
  });

  it('sanitizes transient database failures and permits retry', async () => {
    prisma.messagingChannel.findFirst.mockRejectedValue(
      new Error('private SQL connection detail'),
    );
    const error: unknown = await router
      .sendTemplate(template)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
    expect(String(error)).not.toContain('private SQL');
    expect(meta.sendTemplate).not.toHaveBeenCalled();
  });

  it.each([null, 1, {}, ''])(
    'rejects malformed channel context %# without TypeError',
    async (value) => {
      await expect(
        router.sendTemplate({
          ...template,
          messagingChannelId: value as string,
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_MESSAGE_INPUT',
        retryable: false,
      });
      expect(prisma.messagingChannel.findFirst).not.toHaveBeenCalled();
    },
  );
});
