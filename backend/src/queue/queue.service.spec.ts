import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  MediaAssetStatus,
  OutboundMessageSource,
  OutboundMessageStatus,
  OutboundMessageType,
  MessagingProvider,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EnvMediaUrlPolicy } from '../message-provider/media/env-media-url-policy';
import { MediaUrlPolicy } from '../message-provider/media/media-url-policy.interface';
import { MessagingChannelRoutingService } from '../messaging-channel/messaging-channel-routing.service';
import {
  EnqueueImageMessageInput,
  EnqueueMessageInput,
  EnqueueTemplateMessageInput,
  MAX_IMAGE_CAPTION_LENGTH,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from './dto/enqueue-message.input';
import { QueueService } from './queue.service';
import { MediaAssetEnqueueError } from './media-asset-enqueue.error';

describe('QueueService', () => {
  let service: QueueService;

  const prismaMock = {
    messagingChannel: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
    company: {
      findUnique: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
    },
    automation: {
      findFirst: jest.fn(),
    },
    mediaAsset: {
      findUnique: jest.fn(),
    },
    outboundMessage: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const mediaUrlPolicyMock: jest.Mocked<MediaUrlPolicy> = {
    assertAllowed: jest.fn(),
  };
  const messagingChannelRoutingServiceMock: jest.Mocked<
    Pick<MessagingChannelRoutingService, 'resolveForEnqueue'>
  > = {
    resolveForEnqueue: jest.fn(),
  };

  const companyId = 'company-1';
  const customerId = 'customer-1';
  const automationId = 'automation-1';

  const baseInput = {
    companyId,
    customerId,
    automationId,
    source: OutboundMessageSource.AUTOMATION,
    recipientPhone: '5545999999999',
    content: 'Olá, Luiz!',
    idempotencyKey: 'automation:automation-1:customer:customer-1:2026-07-25',
  };

  const imagePayload = {
    mediaUrl: 'https://media.example.com/campanha.jpg',
    mimeType: 'image/jpeg' as const,
    fileName: 'campanha.jpg',
    fileSize: 123_456,
    caption: 'Legenda opcional',
  };

  const imageInput: EnqueueImageMessageInput = {
    companyId,
    source: OutboundMessageSource.CAMPAIGN,
    type: OutboundMessageType.IMAGE,
    recipientPhone: '5545999999999',
    payload: imagePayload,
    idempotencyKey: 'campaign:image:1',
  };

  const mediaAssetImageInput: EnqueueImageMessageInput = {
    companyId,
    customerId,
    automationId,
    source: OutboundMessageSource.CAMPAIGN,
    type: OutboundMessageType.IMAGE,
    mediaAssetId: 'media-asset-1',
    recipientPhone: '5545999999999',
    payload: {
      caption: 'Legenda da campanha',
    },
    idempotencyKey: 'campaign:automation-1:customer:customer-1',
  };

  const templateInput: EnqueueTemplateMessageInput = {
    companyId,
    source: OutboundMessageSource.MANUAL,
    type: 'TEMPLATE',
    messagingChannelId: 'meta-channel',
    recipientPhone: '5545999999999',
    idempotencyKey: 'template:1',
    payload: { templateName: 'hello_world', languageCode: 'en_US' },
  };

  const outboundMessage = {
    id: 'outbound-message-1',
    companyId,
    customerId,
    automationId,
    source: OutboundMessageSource.AUTOMATION,
    type: OutboundMessageType.TEXT,
    status: OutboundMessageStatus.PENDING,
    recipientPhone: '5545999999999',
    content: 'Olá, Luiz!',
    payload: null,
    scheduledAt: new Date(),
    availableAt: new Date(),
    processingAt: null,
    sentAt: null,
    failedAt: null,
    attempts: 0,
    maxAttempts: 3,
    priority: 0,
    lockedAt: null,
    lockedBy: null,
    provider: null,
    providerMessageId: null,
    lastError: null,
    lastErrorCode: null,
    idempotencyKey: 'automation:automation-1:customer:customer-1:2026-07-25',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new QueueService(
      prismaMock as unknown as PrismaService,
      mediaUrlPolicyMock,
      messagingChannelRoutingServiceMock as unknown as MessagingChannelRoutingService,
    );

    prismaMock.$transaction.mockImplementation(
      async (callback: (prisma: typeof prismaMock) => unknown) =>
        callback(prismaMock),
    );

    const defaultPolicy = new EnvMediaUrlPolicy(() => 'media.example.com');
    mediaUrlPolicyMock.assertAllowed.mockImplementation((mediaUrl) =>
      defaultPolicy.assertAllowed(mediaUrl),
    );

    prismaMock.company.findUnique.mockResolvedValue({
      id: companyId,
    });

    prismaMock.customer.findFirst.mockResolvedValue({
      id: customerId,
    });

    prismaMock.automation.findFirst.mockResolvedValue({
      id: automationId,
    });

    prismaMock.mediaAsset.findUnique.mockResolvedValue({
      status: MediaAssetStatus.READY,
      expiresAt: null,
      mimeType: 'image/jpeg',
      originalName: 'campanha.jpg',
      sizeBytes: 123_456,
    });

    prismaMock.outboundMessage.findUnique.mockResolvedValue(null);
    prismaMock.outboundMessage.upsert.mockResolvedValue(outboundMessage);
    messagingChannelRoutingServiceMock.resolveForEnqueue.mockResolvedValue({
      messagingChannelId: 'channel-1',
    });
  });

  it('deve enfileirar uma mensagem com valores padrão', async () => {
    const result = await service.enqueue(baseInput);

    expect(result).toEqual(outboundMessage);

    expect(prismaMock.company.findUnique).toHaveBeenCalledWith({
      where: {
        id: companyId,
      },
      select: {
        id: true,
      },
    });

    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
      where: {
        id: customerId,
        companyId,
      },
      select: {
        id: true,
      },
    });

    expect(prismaMock.automation.findFirst).toHaveBeenCalledWith({
      where: {
        id: automationId,
        companyId,
      },
      select: {
        id: true,
      },
    });

    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledTimes(1);

    const upsertCall = prismaMock.outboundMessage.upsert.mock.calls[0][0];

    expect(upsertCall.where).toEqual({
      companyId_idempotencyKey: {
        companyId,
        idempotencyKey: baseInput.idempotencyKey,
      },
    });

    expect(upsertCall.update).toEqual({});

    expect(upsertCall.create).toEqual(
      expect.objectContaining({
        companyId,
        customerId,
        automationId,
        messagingChannelId: 'channel-1',
        source: OutboundMessageSource.AUTOMATION,
        type: OutboundMessageType.TEXT,
        status: OutboundMessageStatus.PENDING,
        recipientPhone: baseInput.recipientPhone,
        content: baseInput.content,
        priority: 0,
        maxAttempts: 3,
        idempotencyKey: baseInput.idempotencyKey,
      }),
    );

    expect(upsertCall.create.scheduledAt).toBeInstanceOf(Date);
    expect(upsertCall.create.availableAt).toEqual(
      upsertCall.create.scheduledAt,
    );
  });

  it('deve continuar enfileirando TEXT quando o tipo é explícito', async () => {
    await service.enqueue({
      ...baseInput,
      type: OutboundMessageType.TEXT,
    });

    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          type: OutboundMessageType.TEXT,
          content: baseInput.content,
        }),
      }),
    );
  });

  it('fixa o canal explícito validado dentro da mesma transaction', async () => {
    await service.enqueue({
      ...baseInput,
      messagingChannelId: ' channel-explicit ',
    });

    expect(
      messagingChannelRoutingServiceMock.resolveForEnqueue,
    ).toHaveBeenCalledWith(
      companyId,
      ' channel-explicit ',
      prismaMock,
      OutboundMessageType.TEXT,
    );
    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          messagingChannelId: 'channel-1',
        }),
      }),
    );
  });

  it('resolve automaticamente o canal somente para uma mensagem nova', async () => {
    await service.enqueue(baseInput);

    expect(
      messagingChannelRoutingServiceMock.resolveForEnqueue,
    ).toHaveBeenCalledWith(
      companyId,
      undefined,
      prismaMock,
      OutboundMessageType.TEXT,
    );
  });

  it('não persiste quando o canal explícito não pertence ao tenant', async () => {
    messagingChannelRoutingServiceMock.resolveForEnqueue.mockRejectedValue(
      new NotFoundException('Active messaging channel not found'),
    );

    await expect(
      service.enqueue({ ...baseInput, messagingChannelId: 'other-tenant' }),
    ).rejects.toThrow('Active messaging channel not found');

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('falha sem persistir quando múltiplos canais exigem seleção explícita', async () => {
    messagingChannelRoutingServiceMock.resolveForEnqueue.mockRejectedValue(
      new BadRequestException('Messaging channel selection is required'),
    );

    await expect(service.enqueue(baseInput)).rejects.toThrow(
      'Messaging channel selection is required',
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve usar TEXT como padrão quando o tipo não é informado', async () => {
    await service.enqueue(baseInput);

    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          type: OutboundMessageType.TEXT,
        }),
      }),
    );
  });

  describe('TEMPLATE', () => {
    it.each([
      { bodyParameters: undefined },
      { bodyParameters: [] },
      { bodyParameters: ['Primeiro', 'Segundo'] },
    ])(
      'persists a typed payload with bodyParameters %#',
      async ({ bodyParameters }) => {
        const payload = {
          ...templateInput.payload,
          ...(bodyParameters === undefined ? {} : { bodyParameters }),
        };
        messagingChannelRoutingServiceMock.resolveForEnqueue.mockResolvedValue({
          messagingChannelId: 'meta-channel',
        });
        await service.enqueue({ ...templateInput, payload });
        expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: {},
            create: expect.objectContaining({
              companyId,
              type: OutboundMessageType.TEMPLATE,
              content: '',
              payload,
              messagingChannelId: 'meta-channel',
              status: OutboundMessageStatus.PENDING,
              idempotencyKey: templateInput.idempotencyKey,
            }),
          }),
        );
        expect(
          messagingChannelRoutingServiceMock.resolveForEnqueue,
        ).toHaveBeenCalledWith(
          companyId,
          'meta-channel',
          prismaMock,
          OutboundMessageType.TEMPLATE,
        );
        expect(mediaUrlPolicyMock.assertAllowed).not.toHaveBeenCalled();
      },
    );

    it.each([
      null,
      {},
      { templateName: 'hello_world' },
      { languageCode: 'en_US' },
      { templateName: '', languageCode: 'en_US' },
      { templateName: 'hello_world', languageCode: '' },
      {
        templateName: 'hello_world',
        languageCode: 'en_US',
        bodyParameters: 'invalid',
      },
      {
        templateName: 'hello_world',
        languageCode: 'en_US',
        bodyParameters: [1],
      },
      {
        templateName: 'hello_world',
        languageCode: 'en_US',
        bodyParameters: [' '],
      },
      {
        templateName: 'hello_world',
        languageCode: 'en_US',
        companyId: 'other-tenant',
      },
      {
        templateName: 'hello_world',
        languageCode: 'en_US',
        mediaUrl: 'https://example.test/image.jpg',
      },
    ])(
      'rejects malformed or mixed payload %# before persistence',
      async (payload) => {
        await expect(
          service.enqueue({
            ...templateInput,
            payload,
          } as EnqueueTemplateMessageInput),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
        expect(
          messagingChannelRoutingServiceMock.resolveForEnqueue,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      { companyId: '' },
      { recipientPhone: '' },
      { idempotencyKey: '' },
      { messagingChannelId: undefined },
      { messagingChannelId: '' },
      { messagingChannelId: null },
      { content: 'ambiguous text' },
      { mediaAssetId: 'asset' },
    ])('rejects incomplete context or mixed fields %#', async (changes) => {
      await expect(
        service.enqueue({
          ...templateInput,
          ...changes,
        } as EnqueueTemplateMessageInput),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
    });

    it('returns the previously pinned message without revalidating or overwriting on an idempotent retry', async () => {
      const existing = {
        ...outboundMessage,
        type: OutboundMessageType.TEMPLATE,
        messagingChannelId: 'meta-channel',
        payload: templateInput.payload,
        content: '',
      };
      prismaMock.outboundMessage.findUnique.mockResolvedValue(existing);
      await expect(
        service.enqueue({
          ...templateInput,
          messagingChannelId: 'other-channel',
        }),
      ).resolves.toBe(existing);
      expect(prismaMock.outboundMessage.findUnique).toHaveBeenCalledWith({
        where: {
          companyId_idempotencyKey: {
            companyId,
            idempotencyKey: templateInput.idempotencyKey,
          },
        },
      });
      expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
      expect(
        messagingChannelRoutingServiceMock.resolveForEnqueue,
      ).not.toHaveBeenCalled();
    });
  });

  describe('provider compatibility with real channel routing and mocked Prisma', () => {
    let channel: {
      id: string;
      companyId: string;
      provider: MessagingProvider;
      status: string;
    };
    beforeEach(() => {
      channel = {
        id: 'selected-channel',
        companyId,
        provider: MessagingProvider.EVOLUTION,
        status: 'ACTIVE',
      };
      prismaMock.messagingChannel.findFirst.mockImplementation(
        ({ where }: { where: typeof channel }) =>
          Promise.resolve(
            Object.entries(where).every(
              ([key, value]) => channel[key as keyof typeof channel] === value,
            )
              ? { id: channel.id }
              : null,
          ),
      );
      service = new QueueService(
        prismaMock as unknown as PrismaService,
        mediaUrlPolicyMock,
        new MessagingChannelRoutingService(
          prismaMock as unknown as PrismaService,
        ),
      );
    });

    it.each([
      ['TEXT', MessagingProvider.EVOLUTION, true],
      ['IMAGE', MessagingProvider.EVOLUTION, true],
      ['TEMPLATE', MessagingProvider.META_CLOUD, true],
      ['TEMPLATE', MessagingProvider.EVOLUTION, false],
      ['TEXT', MessagingProvider.META_CLOUD, false],
      ['IMAGE', MessagingProvider.META_CLOUD, false],
    ] as const)(
      '%s / %s allowed=%s with only one channel lookup',
      async (type, provider, allowed) => {
        channel.provider = provider;
        const input: EnqueueMessageInput = {
          ...(type === 'TEMPLATE'
            ? templateInput
            : type === 'IMAGE'
              ? imageInput
              : baseInput),
          messagingChannelId: channel.id,
        };
        if (allowed) {
          await service.enqueue(input);
          expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledTimes(1);
        } else {
          await expect(service.enqueue(input)).rejects.toBeInstanceOf(
            NotFoundException,
          );
          expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
        }
        expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledTimes(1);
        expect(prismaMock.messagingChannel.findMany).not.toHaveBeenCalled();
      },
    );

    it.each(['other-tenant', 'INACTIVE'])(
      'rejects TEMPLATE for %s without persistence or fallback',
      async (mismatch) => {
        channel.provider = MessagingProvider.META_CLOUD;
        if (mismatch === 'INACTIVE') channel.status = mismatch;
        else channel.companyId = mismatch;
        await expect(
          service.enqueue({ ...templateInput, messagingChannelId: channel.id }),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
        expect(prismaMock.messagingChannel.findMany).not.toHaveBeenCalled();
      },
    );
  });

  it('deve enfileirar IMAGE válida com payload estruturado', async () => {
    await service.enqueue(imageInput);

    expect(mediaUrlPolicyMock.assertAllowed).toHaveBeenCalledWith(
      imagePayload.mediaUrl,
    );
    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          type: OutboundMessageType.IMAGE,
          content: imagePayload.caption,
          payload: imagePayload,
        }),
      }),
    );
  });

  it('enfileira IMAGE com MediaAsset READY do mesmo tenant e metadados canônicos', async () => {
    await service.enqueue(mediaAssetImageInput);

    expect(prismaMock.mediaAsset.findUnique).toHaveBeenCalledWith({
      where: {
        id_companyId: {
          id: 'media-asset-1',
          companyId,
        },
      },
      select: {
        status: true,
        expiresAt: true,
        mimeType: true,
        originalName: true,
        sizeBytes: true,
      },
    });
    expect(mediaUrlPolicyMock.assertAllowed).not.toHaveBeenCalled();

    const create = prismaMock.outboundMessage.upsert.mock.calls[0][0].create;
    expect(create).toEqual(
      expect.objectContaining({
        companyId,
        customerId,
        automationId,
        type: OutboundMessageType.IMAGE,
        mediaAssetId: 'media-asset-1',
        content: 'Legenda da campanha',
        payload: {
          mimeType: 'image/jpeg',
          fileName: 'campanha.jpg',
          fileSize: 123_456,
          caption: 'Legenda da campanha',
        },
      }),
    );
    expect(create.payload).not.toHaveProperty('mediaUrl');
    expect(create.payload).not.toHaveProperty('bucket');
    expect(create.payload).not.toHaveProperty('objectKey');
    expect(create.payload).not.toHaveProperty('credentials');
  });

  it('normaliza mediaAssetId antes da validação e da persistência', async () => {
    await service.enqueue({
      ...mediaAssetImageInput,
      mediaAssetId: '  media-asset-1  ',
    });

    expect(prismaMock.mediaAsset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id_companyId: {
            id: 'media-asset-1',
            companyId,
          },
        },
      }),
    );

    const create = prismaMock.outboundMessage.upsert.mock.calls[0][0].create;
    expect(create.mediaAssetId).toBe('media-asset-1');
    expect(create.mediaAssetId).not.toMatch(/^\s|\s$/);
  });

  it('mantém mediaAssetId composto apenas por espaços como inválido', async () => {
    await expect(
      service.enqueue({
        ...mediaAssetImageInput,
        mediaAssetId: '   ',
      }),
    ).rejects.toThrow(new BadRequestException('mediaAssetId é obrigatório'));

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.mediaAsset.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it.each(['mediaUrl', 'bucket', 'objectKey', 'credentials'])(
    'rejeita o campo externo %s no payload vinculado a MediaAsset',
    async (field) => {
      await expect(
        service.enqueue({
          ...mediaAssetImageInput,
          payload: {
            caption: 'Legenda segura',
            [field]: 'sensitive-value',
          },
        } as unknown as EnqueueImageMessageInput),
      ).rejects.toThrow(
        new BadRequestException(
          'payload de MediaAsset contém campos não permitidos',
        ),
      );

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
    },
  );

  it('rejeita MediaAsset inexistente ou de outro tenant antes do upsert', async () => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue(null);

    await expect(service.enqueue(mediaAssetImageInput)).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_FOUND',
      message: 'Media asset was not found',
    } satisfies Partial<MediaAssetEnqueueError>);

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it.each([
    MediaAssetStatus.PENDING,
    MediaAssetStatus.FAILED,
    MediaAssetStatus.DELETE_PENDING,
    MediaAssetStatus.DELETED,
  ])('rejeita MediaAsset no status %s', async (status) => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue({
      status,
      expiresAt: null,
      mimeType: 'image/jpeg',
      originalName: 'campanha.jpg',
      sizeBytes: 123_456,
    });

    await expect(service.enqueue(mediaAssetImageInput)).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_READY',
      message: 'Media asset is not ready',
    });
    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('rejeita MediaAsset expirado', async () => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue({
      status: MediaAssetStatus.READY,
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      mimeType: 'image/jpeg',
      originalName: 'campanha.jpg',
      sizeBytes: 123_456,
    });

    await expect(service.enqueue(mediaAssetImageInput)).rejects.toMatchObject({
      code: 'MEDIA_ASSET_EXPIRED',
      message: 'Media asset has expired',
    });
    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('rejeita IMAGE sem mediaAssetId e sem mediaUrl', async () => {
    await expect(
      service.enqueue({
        ...mediaAssetImageInput,
        mediaAssetId: undefined,
      }),
    ).rejects.toThrow(new BadRequestException('mediaUrl é obrigatória'));

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve permitir IMAGE sem caption', async () => {
    const { caption: _caption, ...payloadWithoutCaption } = imagePayload;

    await service.enqueue({
      ...imageInput,
      payload: payloadWithoutCaption,
    });

    const create = prismaMock.outboundMessage.upsert.mock.calls[0][0].create;
    expect(create.content).toBe('');
    expect(create.payload).toEqual(payloadWithoutCaption);
    expect(create.payload).not.toHaveProperty('caption');
  });

  it.each([undefined, '', 'not-a-url', 'ftp://media.example.com/image.jpg'])(
    'deve rejeitar mediaUrl ausente ou inválida: %s',
    async (mediaUrl) => {
      await expect(
        service.enqueue({
          ...imageInput,
          payload: {
            ...imagePayload,
            mediaUrl,
          },
        } as unknown as EnqueueImageMessageInput),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
    },
  );

  it.each([
    'data:image/png;base64,iVBORw0KGgo=',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
  ])('deve rejeitar data URL ou base64 em mediaUrl', async (mediaUrl) => {
    await expect(
      service.enqueue({
        ...imageInput,
        payload: {
          ...imagePayload,
          mediaUrl,
        },
      }),
    ).rejects.toThrow(new BadRequestException('Media URL is not allowed'));

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve rejeitar host não permitido antes de acessar o Prisma', async () => {
    await expect(
      service.enqueue({
        ...imageInput,
        payload: {
          ...imagePayload,
          mediaUrl: 'https://untrusted.example.com/campaign.jpg',
        },
      }),
    ).rejects.toThrow(new BadRequestException('Media URL is not allowed'));

    expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('não aplica allowlist a mensagens TEXT', async () => {
    await service.enqueue(baseInput);

    expect(mediaUrlPolicyMock.assertAllowed).not.toHaveBeenCalled();
    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledTimes(1);
  });

  it.each(['image/gif', 'application/octet-stream', 'image/webp'])(
    'deve rejeitar MIME não permitido: %s',
    async (mimeType) => {
      await expect(
        service.enqueue({
          ...imageInput,
          payload: {
            ...imagePayload,
            mimeType,
          },
        } as unknown as EnqueueImageMessageInput),
      ).rejects.toThrow(
        new BadRequestException('mimeType deve ser image/jpeg ou image/png'),
      );
    },
  );

  it.each([0, -1, 1.5])(
    'deve rejeitar fileSize que não seja inteiro positivo: %s',
    async (fileSize) => {
      await expect(
        service.enqueue({
          ...imageInput,
          payload: {
            ...imagePayload,
            fileSize,
          },
        }),
      ).rejects.toThrow(
        new BadRequestException('fileSize deve ser um inteiro positivo'),
      );
    },
  );

  it('deve aplicar o limite conservador de tamanho de arquivo', async () => {
    await expect(
      service.enqueue({
        ...imageInput,
        payload: {
          ...imagePayload,
          fileSize: MAX_IMAGE_FILE_SIZE_BYTES + 1,
        },
      }),
    ).rejects.toThrow(
      new BadRequestException(
        `fileSize não pode exceder ${MAX_IMAGE_FILE_SIZE_BYTES} bytes`,
      ),
    );
  });

  it('deve aplicar o limite conservador da legenda', async () => {
    await expect(
      service.enqueue({
        ...imageInput,
        payload: {
          ...imagePayload,
          caption: 'a'.repeat(MAX_IMAGE_CAPTION_LENGTH + 1),
        },
      }),
    ).rejects.toThrow(
      new BadRequestException(
        `caption não pode exceder ${MAX_IMAGE_CAPTION_LENGTH} caracteres`,
      ),
    );
  });

  it.each(['companyId', 'idempotencyKey'] as const)(
    'deve rejeitar campo interno %s no payload',
    async (internalField) => {
      await expect(
        service.enqueue({
          ...imageInput,
          payload: {
            ...imagePayload,
            [internalField]: 'internal-value',
          },
        } as unknown as EnqueueImageMessageInput),
      ).rejects.toThrow(
        new BadRequestException(
          `${internalField} não pode ser incluído no payload`,
        ),
      );
    },
  );

  it('deve manter a idempotência tenant-aware para IMAGE', async () => {
    await service.enqueue(imageInput);
    await service.enqueue({
      ...imageInput,
      companyId: 'company-2',
    });

    expect(
      prismaMock.outboundMessage.upsert.mock.calls.map(
        ([call]) => call.where.companyId_idempotencyKey,
      ),
    ).toEqual([
      {
        companyId,
        idempotencyKey: imageInput.idempotencyKey,
      },
      {
        companyId: 'company-2',
        idempotencyKey: imageInput.idempotencyKey,
      },
    ]);
  });

  it('deve respeitar agendamento, prioridade e limite de tentativas', async () => {
    const scheduledAt = new Date('2026-07-25T15:00:00.000Z');

    await service.enqueue({
      ...baseInput,
      scheduledAt,
      priority: 10,
      maxAttempts: 5,
    });

    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          scheduledAt,
          availableAt: scheduledAt,
          priority: 10,
          maxAttempts: 5,
        }),
      }),
    );
  });

  it('deve retornar a mensagem existente pela chave de idempotência', async () => {
    const existingMessage = {
      ...outboundMessage,
      status: OutboundMessageStatus.SENT,
      sentAt: new Date(),
    };

    prismaMock.outboundMessage.findUnique.mockResolvedValue(existingMessage);

    const result = await service.enqueue(baseInput);

    expect(result).toEqual(existingMessage);

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
    expect(
      messagingChannelRoutingServiceMock.resolveForEnqueue,
    ).not.toHaveBeenCalled();
  });

  it('deve rejeitar empresa inexistente', async () => {
    prismaMock.company.findUnique.mockResolvedValue(null);

    await expect(service.enqueue(baseInput)).rejects.toThrow(
      new NotFoundException('Empresa não encontrada'),
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve rejeitar cliente que não pertence à empresa', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(null);

    await expect(service.enqueue(baseInput)).rejects.toThrow(
      new NotFoundException('Cliente não encontrado para esta empresa'),
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve rejeitar automação que não pertence à empresa', async () => {
    prismaMock.automation.findFirst.mockResolvedValue(null);

    await expect(service.enqueue(baseInput)).rejects.toThrow(
      new NotFoundException('Automação não encontrada para esta empresa'),
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve permitir mensagem sem cliente e sem automação', async () => {
    const input = {
      companyId,
      source: OutboundMessageSource.MANUAL,
      recipientPhone: '5545888888888',
      content: 'Mensagem manual',
      idempotencyKey: 'manual:company-1:message-1',
    };

    await service.enqueue(input);

    expect(prismaMock.customer.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.automation.findFirst).not.toHaveBeenCalled();

    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          companyId,
          customerId: undefined,
          automationId: undefined,
          source: OutboundMessageSource.MANUAL,
        }),
      }),
    );
  });

  it.each([
    {
      field: 'companyId',
      value: '',
      message: 'companyId é obrigatório',
    },
    {
      field: 'recipientPhone',
      value: '   ',
      message: 'recipientPhone é obrigatório',
    },
    {
      field: 'content',
      value: '',
      message: 'content é obrigatório',
    },
    {
      field: 'idempotencyKey',
      value: '',
      message: 'idempotencyKey é obrigatório',
    },
  ])('deve rejeitar $field inválido', async ({ field, value, message }) => {
    await expect(
      service.enqueue({
        ...baseInput,
        [field]: value,
      }),
    ).rejects.toThrow(new BadRequestException(message));

    expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve rejeitar prioridade negativa', async () => {
    await expect(
      service.enqueue({
        ...baseInput,
        priority: -1,
      }),
    ).rejects.toThrow(
      new BadRequestException('priority não pode ser menor que zero'),
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve rejeitar maxAttempts menor que um', async () => {
    await expect(
      service.enqueue({
        ...baseInput,
        maxAttempts: 0,
      }),
    ).rejects.toThrow(
      new BadRequestException('maxAttempts deve ser maior ou igual a um'),
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('deve rejeitar scheduledAt inválido', async () => {
    await expect(
      service.enqueue({
        ...baseInput,
        scheduledAt: new Date('data-inválida'),
      }),
    ).rejects.toThrow(new BadRequestException('scheduledAt é inválido'));

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
  });
});
