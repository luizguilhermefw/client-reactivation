import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MessagingChannel,
  MessagingChannelConnectionStatus,
  MessagingChannelStatus,
  MessagingProvider,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { EvolutionWebhookProvisioningService } from '../evolution-webhook-provisioning/evolution-webhook-provisioning.service';
import type { EvolutionInstanceProvisioningClient } from './evolution-instance-provisioning-client.interface';
import { MessagingChannelProvisioningService } from './messaging-channel-provisioning.service';

describe('MessagingChannelProvisioningService', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');
  const channel = (
    overrides: Partial<MessagingChannel> = {},
  ): MessagingChannel => ({
    id: '4b4e5167-1519-45e4-8aa5-5fca76d0792b',
    companyId: 'company-a',
    provider: MessagingProvider.EVOLUTION,
    instanceName: 'ayla_existinginstance',
    status: MessagingChannelStatus.INACTIVE,
    connectionStatus: MessagingChannelConnectionStatus.PROVISIONING,
    provisioningKey: '11111111-1111-4111-8111-111111111111',
    lastConnectionCheckAt: null,
    connectedPhone: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const transactionMock = {
    messagingChannel: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    companyEntitlement: { findUnique: jest.fn() },
  };
  const prismaMock = {
    $transaction: jest.fn(),
    messagingChannel: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const entitlementServiceMock = { getLimit: jest.fn() };
  const webhookProvisioningServiceMock = {
    ensureConfiguredForInstance: jest.fn(),
  };
  const evolutionClientMock: jest.Mocked<EvolutionInstanceProvisioningClient> =
    {
      createInstance: jest.fn(),
      inspectInstance: jest.fn(),
      getConnectionState: jest.fn(),
      getQrCode: jest.fn(),
      getPairingCode: jest.fn(),
    };
  let service: MessagingChannelProvisioningService;

  beforeEach(() => {
    jest.clearAllMocks();
    transactionMock.messagingChannel.findUnique.mockResolvedValue(null);
    transactionMock.companyEntitlement.findUnique.mockResolvedValue({
      limit: 1,
    });
    transactionMock.messagingChannel.count.mockResolvedValue(0);
    transactionMock.messagingChannel.create.mockResolvedValue(channel());
    prismaMock.$transaction.mockImplementation(
      async (callback: (transaction: typeof transactionMock) => unknown) =>
        callback(transactionMock),
    );
    prismaMock.messagingChannel.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.messagingChannel.findFirst.mockResolvedValue(channel());
    prismaMock.messagingChannel.findMany.mockResolvedValue([]);
    entitlementServiceMock.getLimit.mockResolvedValue(0);
    webhookProvisioningServiceMock.ensureConfiguredForInstance.mockResolvedValue(
      { configured: true },
    );
    evolutionClientMock.inspectInstance.mockResolvedValue(null);
    evolutionClientMock.createInstance.mockResolvedValue({
      connectionStatus: 'WAITING_QR',
      qrCode: 'fictional-qr',
    });
    evolutionClientMock.getQrCode.mockResolvedValue({
      connectionStatus: 'WAITING_QR',
      qrCode: 'fictional-qr',
    });
    evolutionClientMock.getConnectionState.mockResolvedValue({
      connectionStatus: 'DISCONNECTED',
    });
    evolutionClientMock.getPairingCode.mockResolvedValue({
      connectionStatus: 'WAITING_QR',
      pairingCode: 'LG99-3161',
    });

    service = new MessagingChannelProvisioningService(
      prismaMock as unknown as PrismaService,
      entitlementServiceMock as unknown as EntitlementService,
      webhookProvisioningServiceMock as unknown as EvolutionWebhookProvisioningService,
      evolutionClientMock,
    );
  });

  it('blocks fail-closed when entitlement limit is zero', async () => {
    transactionMock.companyEntitlement.findUnique.mockResolvedValue(null);

    await expect(
      service.provision('company-a', '11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transactionMock.messagingChannel.create).not.toHaveBeenCalled();
    expect(evolutionClientMock.createInstance).not.toHaveBeenCalled();
  });

  it('reserves the first channel as INACTIVE in a Serializable transaction', async () => {
    await expect(
      service.provision('company-a', '11111111-1111-4111-8111-111111111111'),
    ).resolves.toEqual({
      channelId: channel().id,
      connectionStatus: MessagingChannelConnectionStatus.WAITING_QR,
      qrCode: 'fictional-qr',
    });

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(transactionMock.messagingChannel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-a',
        provider: MessagingProvider.EVOLUTION,
        status: MessagingChannelStatus.INACTIVE,
        connectionStatus: MessagingChannelConnectionStatus.PROVISIONING,
        provisioningKey: '11111111-1111-4111-8111-111111111111',
        instanceName: expect.stringMatching(/^ayla_[0-9a-f]{24}$/),
      }),
    });
    expect(
      webhookProvisioningServiceMock.ensureConfiguredForInstance,
    ).toHaveBeenCalledWith({
      companyId: 'company-a',
      instanceName: channel().instanceName,
    });
  });

  it('counts every persisted EVOLUTION channel only inside the JWT tenant', async () => {
    transactionMock.companyEntitlement.findUnique.mockResolvedValue({
      limit: 3,
    });

    await service.provision(
      'company-a',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(transactionMock.messagingChannel.count).toHaveBeenCalledWith({
      where: {
        companyId: 'company-a',
        provider: MessagingProvider.EVOLUTION,
      },
    });
  });

  it.each([0, 1, 2])(
    'allows a reservation with limit 3 and %i channels already used',
    async (used) => {
      transactionMock.companyEntitlement.findUnique.mockResolvedValue({
        limit: 3,
      });
      transactionMock.messagingChannel.count.mockResolvedValue(used);

      await expect(
        service.provision('company-a', '11111111-1111-4111-8111-111111111111'),
      ).resolves.toEqual(expect.objectContaining({ channelId: channel().id }));
      expect(transactionMock.messagingChannel.create).toHaveBeenCalledTimes(1);
    },
  );

  it('blocks when used equals the entitlement limit', async () => {
    transactionMock.companyEntitlement.findUnique.mockResolvedValue({
      limit: 3,
    });
    transactionMock.messagingChannel.count.mockResolvedValue(3);

    await expect(
      service.provision('company-a', '11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('retries a serialization conflict and cannot exceed the entitlement', async () => {
    prismaMock.$transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(
        async (callback: (transaction: typeof transactionMock) => unknown) => {
          transactionMock.messagingChannel.count.mockResolvedValueOnce(1);
          return callback(transactionMock);
        },
      );

    await expect(
      service.provision('company-a', '11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(transactionMock.messagingChannel.create).not.toHaveBeenCalled();
  });

  it('reuses the same channel and instanceName for an idempotent retry', async () => {
    transactionMock.messagingChannel.findUnique.mockResolvedValue(channel());
    evolutionClientMock.inspectInstance.mockResolvedValue({
      connectionStatus: 'WAITING_QR',
    });

    await service.provision(
      'company-a',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(transactionMock.messagingChannel.create).not.toHaveBeenCalled();
    expect(evolutionClientMock.createInstance).not.toHaveBeenCalled();
    expect(evolutionClientMock.inspectInstance).toHaveBeenCalledWith(
      channel().instanceName,
    );
  });

  it('scopes the same provisioning key independently by company', async () => {
    await service.provision(
      'company-b',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(transactionMock.messagingChannel.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_provisioningKey: {
          companyId: 'company-b',
          provisioningKey: '11111111-1111-4111-8111-111111111111',
        },
      },
    });
  });

  it('resolves an idempotency unique race to the channel committed by the winner', async () => {
    prismaMock.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.messagingChannel.findUnique.mockResolvedValue(channel());
    evolutionClientMock.inspectInstance.mockResolvedValue({
      connectionStatus: 'WAITING_QR',
    });

    await expect(
      service.provision('company-a', '11111111-1111-4111-8111-111111111111'),
    ).resolves.toEqual(expect.objectContaining({ channelId: channel().id }));
    expect(prismaMock.messagingChannel.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_provisioningKey: {
          companyId: 'company-a',
          provisioningKey: '11111111-1111-4111-8111-111111111111',
        },
      },
    });
    expect(transactionMock.messagingChannel.create).not.toHaveBeenCalled();
  });

  it('reconciles an instance created before a timeout instead of creating a new name', async () => {
    evolutionClientMock.createInstance.mockRejectedValue(
      new Error('provider timeout'),
    );
    evolutionClientMock.inspectInstance
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ connectionStatus: 'WAITING_QR' });

    await service.provision(
      'company-a',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(evolutionClientMock.createInstance).toHaveBeenCalledTimes(1);
    expect(evolutionClientMock.inspectInstance).toHaveBeenNthCalledWith(
      2,
      channel().instanceName,
    );
    expect(evolutionClientMock.getQrCode).toHaveBeenCalledWith(
      channel().instanceName,
    );
  });

  it('preserves the channel and marks ERROR when a partial provider flow fails', async () => {
    evolutionClientMock.inspectInstance.mockRejectedValue(
      new Error('provider unavailable'),
    );

    await expect(
      service.provision('company-a', '11111111-1111-4111-8111-111111111111'),
    ).rejects.toEqual(
      new ServiceUnavailableException(
        'WhatsApp channel provisioning is temporarily unavailable',
      ),
    );
    expect(prismaMock.messagingChannel.updateMany).toHaveBeenCalledWith({
      where: {
        id: channel().id,
        companyId: 'company-a',
        provider: MessagingProvider.EVOLUTION,
      },
      data: expect.objectContaining({
        connectionStatus: MessagingChannelConnectionStatus.ERROR,
      }),
    });
    expect(transactionMock.messagingChannel.create).toHaveBeenCalledTimes(1);
  });

  it('does not create a second external instance after a non-reconciled provider error', async () => {
    evolutionClientMock.createInstance.mockRejectedValue(
      new Error('provider rejected request'),
    );
    evolutionClientMock.inspectInstance.mockResolvedValue(null);

    await expect(
      service.provision('company-a', '11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(evolutionClientMock.createInstance).toHaveBeenCalledTimes(1);
    expect(transactionMock.messagingChannel.create).toHaveBeenCalledTimes(1);
  });

  it('never persists a QR code', async () => {
    await service.provision(
      'company-a',
      '11111111-1111-4111-8111-111111111111',
    );

    const writes = JSON.stringify([
      transactionMock.messagingChannel.create.mock.calls,
      prismaMock.messagingChannel.updateMany.mock.calls,
    ]);
    expect(writes).not.toContain('fictional-qr');
    expect(writes).not.toContain('qrCode');
  });

  it('returns 404 safely for a channel from another tenant before provider access', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

    await expect(
      service.getQrCode('company-b', channel().id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(evolutionClientMock.getQrCode).not.toHaveBeenCalled();
  });

  it('resolves pairing strictly by channelId, companyId and EVOLUTION provider', async () => {
    await service.getPairingCode(
      'company-a',
      channel().id,
      '(45) 99133-5359',
    );

    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith({
      where: {
        id: channel().id,
        companyId: 'company-a',
        provider: MessagingProvider.EVOLUTION,
      },
    });
    expect(evolutionClientMock.getPairingCode).toHaveBeenCalledWith(
      channel().instanceName,
      '5545991335359',
    );
  });

  it.each([
    MessagingChannelStatus.ACTIVE,
    MessagingChannelStatus.INACTIVE,
  ])(
    'generates pairing for a %s routing channel without changing routing',
    async (status) => {
      prismaMock.messagingChannel.findFirst.mockResolvedValue(
        channel({ status }),
      );

      const result = await service.getPairingCode(
        'company-a',
        channel().id,
        '5545991335359',
      );

      expect(result).toEqual({
        channelId: channel().id,
        connectionStatus: MessagingChannelConnectionStatus.WAITING_QR,
        pairingCode: 'LG99-3161',
      });
      const update = prismaMock.messagingChannel.updateMany.mock.calls[0][0];
      expect(update.where).toEqual({
        id: channel().id,
        companyId: 'company-a',
        provider: MessagingProvider.EVOLUTION,
      });
      expect(update.data).not.toHaveProperty('status');
      expect(JSON.stringify(result)).not.toMatch(
        /instanceName|provisioningKey|apiKey|webhookSecret|companyId/i,
      );
    },
  );

  it('fails safely for cross-tenant or wrong-provider pairing without fallback', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

    await expect(
      service.getPairingCode(
        'company-b',
        channel().id,
        '5545991335359',
      ),
    ).rejects.toEqual(new NotFoundException('Channel not found'));
    expect(evolutionClientMock.getPairingCode).not.toHaveBeenCalled();
    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledTimes(1);
  });

  it.each(['', '1', '1234', '999999', '5512']) (
    'rejects invalid pairing phone %j before provider access',
    async (phone) => {
      await expect(
        service.getPairingCode('company-a', channel().id, phone),
      ).rejects.toEqual(
        new BadRequestException('A valid Brazilian phone is required'),
      );
      expect(evolutionClientMock.getPairingCode).not.toHaveBeenCalled();
    },
  );

  it('does not request pairing again when the channel is already CONNECTED', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(
      channel({
        connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
      }),
    );

    await expect(
      service.getPairingCode(
        'company-a',
        channel().id,
        '5545991335359',
      ),
    ).resolves.toEqual({
      channelId: channel().id,
      connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
    });
    expect(evolutionClientMock.getPairingCode).not.toHaveBeenCalled();
    expect(prismaMock.messagingChannel.updateMany).not.toHaveBeenCalled();
  });

  it('maps pairing provider failures to a safe public error', async () => {
    evolutionClientMock.getPairingCode.mockRejectedValue(
      new Error('sensitive provider detail'),
    );

    await expect(
      service.getPairingCode(
        'company-a',
        channel().id,
        '5545991335359',
      ),
    ).rejects.toEqual(
      new ServiceUnavailableException(
        'WhatsApp pairing code is temporarily unavailable',
      ),
    );
  });

  it('synchronizes a legacy UNKNOWN channel from Evolution without inferring from routing status', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(
      channel({
        status: MessagingChannelStatus.ACTIVE,
        connectionStatus: MessagingChannelConnectionStatus.UNKNOWN,
      }),
    );
    const response = await service.getConnection('company-a', channel().id);

    expect(response).toEqual({
      channelId: channel().id,
      connectionStatus: MessagingChannelConnectionStatus.DISCONNECTED,
      connectedPhone: null,
      isActive: true,
    });
    expect(prismaMock.messagingChannel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          connectionStatus: MessagingChannelConnectionStatus.DISCONNECTED,
        }),
      }),
    );
  });

  it('persists a connected phone for DISCONNECTED without changing routing status', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(
      channel({
        status: MessagingChannelStatus.ACTIVE,
        connectionStatus: MessagingChannelConnectionStatus.UNKNOWN,
      }),
    );
    evolutionClientMock.getConnectionState.mockResolvedValue({
      connectionStatus: 'DISCONNECTED',
      connectedPhone: '554591335359',
    });

    await expect(
      service.getConnection('company-a', channel().id),
    ).resolves.toEqual({
      channelId: channel().id,
      connectionStatus: MessagingChannelConnectionStatus.DISCONNECTED,
      connectedPhone: '554591335359',
      isActive: true,
    });
    const updateData =
      prismaMock.messagingChannel.updateMany.mock.calls[0][0].data;
    expect(updateData).toEqual(
      expect.objectContaining({
        connectionStatus: MessagingChannelConnectionStatus.DISCONNECTED,
        connectedPhone: '554591335359',
      }),
    );
    expect(updateData).not.toHaveProperty('status');
  });

  it.each([
    [MessagingChannelStatus.INACTIVE, false],
    [MessagingChannelStatus.ACTIVE, true],
  ])(
    'preserves routing %s when getConnection synchronizes CONNECTED',
    async (status, isActive) => {
      prismaMock.messagingChannel.findFirst.mockResolvedValue(
        channel({
          status,
          connectionStatus: MessagingChannelConnectionStatus.DISCONNECTED,
        }),
      );
      evolutionClientMock.getConnectionState.mockResolvedValue({
        connectionStatus: 'CONNECTED',
        connectedPhone: '554591335359',
      });

      await expect(
        service.getConnection('company-a', channel().id),
      ).resolves.toEqual({
        channelId: channel().id,
        connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
        connectedPhone: '554591335359',
        isActive,
      });
      expect(prismaMock.messagingChannel.updateMany).toHaveBeenCalledWith({
        where: {
          id: channel().id,
          companyId: 'company-a',
          provider: MessagingProvider.EVOLUTION,
        },
        data: expect.objectContaining({
          connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
          connectedPhone: '554591335359',
        }),
      });
      const updateData =
        prismaMock.messagingChannel.updateMany.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('status');
      expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it('does not promote the first connected channel or search for another ACTIVE channel', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(
      channel({
        status: MessagingChannelStatus.INACTIVE,
        connectionStatus: MessagingChannelConnectionStatus.DISCONNECTED,
      }),
    );
    evolutionClientMock.getConnectionState.mockResolvedValue({
      connectionStatus: 'CONNECTED',
    });

    await expect(
      service.getConnection('company-a', channel().id),
    ).resolves.toEqual(
      expect.objectContaining({
        connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
        isActive: false,
      }),
    );
    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith({
      where: {
        id: channel().id,
        companyId: 'company-a',
        provider: MessagingProvider.EVOLUTION,
      },
    });
  });

  it('preserves INACTIVE when getQrCode reports CONNECTED', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(
      channel({
        status: MessagingChannelStatus.INACTIVE,
        connectionStatus: MessagingChannelConnectionStatus.WAITING_QR,
      }),
    );
    evolutionClientMock.getQrCode.mockResolvedValue({
      connectionStatus: 'CONNECTED',
      connectedPhone: '554591335359',
    });

    await expect(
      service.getQrCode('company-a', channel().id),
    ).resolves.toEqual({
      channelId: channel().id,
      connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
    });
    const updateData =
      prismaMock.messagingChannel.updateMany.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('status');
  });

  it('persists stale CONNECTED to DISCONNECTED without routing or phone inference', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(
      channel({
        status: MessagingChannelStatus.INACTIVE,
        connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
        connectedPhone: null,
      }),
    );
    evolutionClientMock.getConnectionState.mockResolvedValue({
      connectionStatus: 'DISCONNECTED',
    });

    await expect(
      service.getConnection('company-a', channel().id),
    ).resolves.toEqual({
      channelId: channel().id,
      connectionStatus: MessagingChannelConnectionStatus.DISCONNECTED,
      connectedPhone: null,
      isActive: false,
    });
    const updateData =
      prismaMock.messagingChannel.updateMany.mock.calls[0][0].data;
    expect(updateData).toEqual(
      expect.objectContaining({
        connectionStatus: MessagingChannelConnectionStatus.DISCONNECTED,
      }),
    );
    expect(updateData).not.toHaveProperty('status');
    expect(updateData).not.toHaveProperty('connectedPhone');
  });

  it('preserves INACTIVE when provisioning finds an already CONNECTED instance', async () => {
    evolutionClientMock.inspectInstance.mockResolvedValue({
      connectionStatus: 'CONNECTED',
      connectedPhone: '554591335359',
    });

    await expect(
      service.provision('company-a', '11111111-1111-4111-8111-111111111111'),
    ).resolves.toEqual({
      channelId: channel().id,
      connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
    });
    const updateData =
      prismaMock.messagingChannel.updateMany.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('status');
  });

  it('preserves INACTIVE through pairing followed by CONNECTED polling', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(
      channel({
        status: MessagingChannelStatus.INACTIVE,
        connectionStatus: MessagingChannelConnectionStatus.DISCONNECTED,
      }),
    );

    await service.getPairingCode(
      'company-a',
      channel().id,
      '5545991335359',
    );
    evolutionClientMock.getConnectionState.mockResolvedValue({
      connectionStatus: 'CONNECTED',
    });
    const connection = await service.getConnection(
      'company-a',
      channel().id,
    );

    expect(connection.isActive).toBe(false);
    expect(prismaMock.messagingChannel.updateMany).toHaveBeenCalledTimes(2);
    for (const call of prismaMock.messagingChannel.updateMany.mock.calls) {
      expect(call[0].data).not.toHaveProperty('status');
    }
  });

  it('maps connection synchronization failures to a safe error', async () => {
    evolutionClientMock.getConnectionState.mockResolvedValue({
      connectionStatus: 'CONNECTED',
    });
    prismaMock.messagingChannel.updateMany.mockRejectedValue(
      new Error('sensitive database connection detail'),
    );

    await expect(
      service.getConnection('company-a', channel().id),
    ).rejects.toEqual(
      new ServiceUnavailableException(
        'WhatsApp connection state could not be synchronized',
      ),
    );
  });

  it('lists safe tenant-scoped capacity without internal channel fields', async () => {
    entitlementServiceMock.getLimit.mockResolvedValue(3);
    prismaMock.messagingChannel.findMany.mockResolvedValue([
      {
        id: channel().id,
        connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
        connectedPhone: '5545999999999',
        status: MessagingChannelStatus.ACTIVE,
      },
    ]);

    const result = await service.list('company-a');

    expect(result).toEqual({
      limit: 3,
      used: 1,
      available: 2,
      channels: [
        {
          id: channel().id,
          connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
          connectedPhone: '5545999999999',
          isActive: true,
        },
      ],
    });
    expect(prismaMock.messagingChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-a',
          provider: MessagingProvider.EVOLUTION,
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain(channel().instanceName);
    expect(JSON.stringify(result)).not.toContain('provisioningKey');
    expect(JSON.stringify(result)).not.toContain('companyId');
  });
});
