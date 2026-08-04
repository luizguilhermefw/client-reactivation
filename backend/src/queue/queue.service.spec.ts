import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  OutboundMessageSource,
  OutboundMessageStatus,
  OutboundMessageType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EnqueueImageMessageInput,
  MAX_IMAGE_CAPTION_LENGTH,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from './dto/enqueue-message.input';
import { QueueService } from './queue.service';

describe('QueueService', () => {
  let service: QueueService;

  const prismaMock = {
    company: {
      findUnique: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
    },
    automation: {
      findFirst: jest.fn(),
    },
    outboundMessage: {
      upsert: jest.fn(),
    },
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

    service = new QueueService(prismaMock as unknown as PrismaService);

    prismaMock.company.findUnique.mockResolvedValue({
      id: companyId,
    });

    prismaMock.customer.findFirst.mockResolvedValue({
      id: customerId,
    });

    prismaMock.automation.findFirst.mockResolvedValue({
      id: automationId,
    });

    prismaMock.outboundMessage.upsert.mockResolvedValue(outboundMessage);
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

  it('deve enfileirar IMAGE válida com payload estruturado', async () => {
    await service.enqueue(imageInput);

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
    ).rejects.toThrow(
      new BadRequestException('mediaUrl deve ser uma URL HTTP/HTTPS válida'),
    );

    expect(prismaMock.outboundMessage.upsert).not.toHaveBeenCalled();
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

    prismaMock.outboundMessage.upsert.mockResolvedValue(existingMessage);

    const result = await service.enqueue(baseInput);

    expect(result).toEqual(existingMessage);

    expect(prismaMock.outboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {},
      }),
    );
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
