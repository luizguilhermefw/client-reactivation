import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  MessagingChannelConnectionStatus,
  MessagingChannelStatus,
  MessagingProvider,
  OutboundMessageType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingChannelRoutingService } from './messaging-channel-routing.service';

describe('MessagingChannelRoutingService', () => {
  const prismaMock = {
    messagingChannel: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  let service: MessagingChannelRoutingService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.messagingChannel.findFirst.mockResolvedValue({
      id: 'channel-1',
      connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
    });
    prismaMock.messagingChannel.findMany.mockResolvedValue([
      { id: 'channel-1' },
    ]);
    prismaMock.messagingChannel.updateMany.mockResolvedValue({ count: 1 });
    service = new MessagingChannelRoutingService(
      prismaMock as unknown as PrismaService,
    );
  });

  describe('resolveForEnqueue', () => {
    it('requires an explicit ACTIVE META_CLOUD channel for TEMPLATE', async () => {
      await expect(
        service.resolveForEnqueue(
          'company-a',
          'channel-1',
          undefined,
          OutboundMessageType.TEMPLATE,
        ),
      ).resolves.toEqual({ messagingChannelId: 'channel-1' });
      expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'channel-1',
          companyId: 'company-a',
          provider: MessagingProvider.META_CLOUD,
          status: MessagingChannelStatus.ACTIVE,
        },
        select: { id: true },
      });
      expect(prismaMock.messagingChannel.findMany).not.toHaveBeenCalled();
    });

    it('does not implicitly select a channel for TEMPLATE', async () => {
      await expect(
        service.resolveForEnqueue(
          'company-a',
          undefined,
          undefined,
          OutboundMessageType.TEMPLATE,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.messagingChannel.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.messagingChannel.findMany).not.toHaveBeenCalled();
    });
    it('resolves an explicit ACTIVE EVOLUTION channel from the same tenant', async () => {
      await expect(
        service.resolveForEnqueue(' company-a ', ' channel-1 '),
      ).resolves.toEqual({ messagingChannelId: 'channel-1' });

      expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'channel-1',
          companyId: 'company-a',
          provider: MessagingProvider.EVOLUTION,
          status: MessagingChannelStatus.ACTIVE,
        },
        select: { id: true },
      });
    });

    it('fails closed for an explicit channel from another tenant', async () => {
      prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveForEnqueue('company-a', 'company-b-channel'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-a' }),
        }),
      );
    });

    it('fails closed for an explicit INACTIVE channel', async () => {
      prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveForEnqueue('company-a', 'inactive-channel'),
      ).rejects.toEqual(
        new NotFoundException('Active messaging channel not found'),
      );
      expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: MessagingChannelStatus.ACTIVE,
          }),
        }),
      );
    });

    it('fails closed for a non-EVOLUTION channel', async () => {
      prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveForEnqueue('company-a', 'other-provider-channel'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            provider: MessagingProvider.EVOLUTION,
          }),
        }),
      );
    });

    it('uses the only ACTIVE EVOLUTION channel as implicit default', async () => {
      await expect(service.resolveForEnqueue('company-a')).resolves.toEqual({
        messagingChannelId: 'channel-1',
      });
      expect(prismaMock.messagingChannel.findMany).toHaveBeenCalledWith({
        where: {
          companyId: 'company-a',
          provider: MessagingProvider.EVOLUTION,
          status: MessagingChannelStatus.ACTIVE,
        },
        take: 2,
        select: { id: true },
      });
    });

    it('fails closed when the tenant has no ACTIVE channel', async () => {
      prismaMock.messagingChannel.findMany.mockResolvedValue([]);

      await expect(service.resolveForEnqueue('company-a')).rejects.toEqual(
        new BadRequestException('No active messaging channel is available'),
      );
    });

    it('requires explicit selection when multiple ACTIVE channels exist', async () => {
      prismaMock.messagingChannel.findMany.mockResolvedValue([
        { id: 'channel-1' },
        { id: 'channel-2' },
      ]);

      await expect(service.resolveForEnqueue('company-a')).rejects.toEqual(
        new BadRequestException('Messaging channel selection is required'),
      );
    });

    it('uses the supplied transaction client without falling back to PrismaService', async () => {
      const transactionMock = {
        messagingChannel: {
          findFirst: jest.fn().mockResolvedValue({ id: 'channel-transaction' }),
          findMany: jest.fn(),
        },
      };

      await expect(
        service.resolveForEnqueue(
          'company-a',
          'channel-transaction',
          transactionMock as unknown as Prisma.TransactionClient,
        ),
      ).resolves.toEqual({ messagingChannelId: 'channel-transaction' });
      expect(transactionMock.messagingChannel.findFirst).toHaveBeenCalled();
      expect(prismaMock.messagingChannel.findFirst).not.toHaveBeenCalled();
    });

    it('does not use technical connectionStatus as routing authorization', async () => {
      prismaMock.messagingChannel.findFirst.mockResolvedValue({
        id: 'channel-1',
      });

      await service.resolveForEnqueue('company-a', 'channel-1');

      const where =
        prismaMock.messagingChannel.findFirst.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('connectionStatus');
    });

    it.each([null, 42, {}])(
      'fails safely for malformed explicit channel value %#',
      async (malformedChannelId) => {
        await expect(
          service.resolveForEnqueue(
            'company-a',
            malformedChannelId as unknown as string,
          ),
        ).rejects.toEqual(
          new BadRequestException('Messaging channel is required'),
        );
        expect(prismaMock.messagingChannel.findFirst).not.toHaveBeenCalled();
        expect(prismaMock.messagingChannel.findMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('updateRoutingStatus', () => {
    it('activating a second CONNECTED channel does not deactivate the first', async () => {
      prismaMock.messagingChannel.findFirst.mockResolvedValue({
        id: 'channel-2',
        connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
      });
      const result = await service.updateRoutingStatus(
        'company-a',
        'channel-2',
        true,
      );

      expect(prismaMock.messagingChannel.updateMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.messagingChannel.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'channel-2',
          companyId: 'company-a',
          provider: MessagingProvider.EVOLUTION,
          connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
        },
        data: { status: MessagingChannelStatus.ACTIVE },
      });
      expect(prismaMock.messagingChannel.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        channelId: 'channel-2',
        isActive: true,
        connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
      });
    });

    it.each([
      MessagingChannelConnectionStatus.DISCONNECTED,
      MessagingChannelConnectionStatus.WAITING_QR,
      MessagingChannelConnectionStatus.ERROR,
    ])(
      'cannot activate a channel in technical state %s',
      async (connectionStatus) => {
        prismaMock.messagingChannel.findFirst.mockResolvedValue({
          id: 'channel-1',
          connectionStatus,
        });

        await expect(
          service.updateRoutingStatus('company-a', 'channel-1', true),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prismaMock.messagingChannel.updateMany).not.toHaveBeenCalled();
      },
    );

    it('fails closed for cross-tenant activation', async () => {
      prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

      await expect(
        service.updateRoutingStatus('company-a', 'company-b-channel', true),
      ).rejects.toEqual(new NotFoundException('Messaging channel not found'));
      expect(prismaMock.messagingChannel.updateMany).not.toHaveBeenCalled();
    });

    it('deactivates regardless of connectionStatus and changes no technical state', async () => {
      prismaMock.messagingChannel.findFirst.mockResolvedValue({
        id: 'channel-1',
        connectionStatus: MessagingChannelConnectionStatus.ERROR,
      });

      await expect(
        service.updateRoutingStatus('company-a', 'channel-1', false),
      ).resolves.toEqual({
        channelId: 'channel-1',
        isActive: false,
        connectionStatus: MessagingChannelConnectionStatus.ERROR,
      });
      expect(prismaMock.messagingChannel.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'channel-1',
          companyId: 'company-a',
          provider: MessagingProvider.EVOLUTION,
        },
        data: { status: MessagingChannelStatus.INACTIVE },
      });
    });

    it('returns only safe routing fields', async () => {
      const result = await service.updateRoutingStatus(
        'company-a',
        'channel-1',
        true,
      );

      expect(result).toEqual({
        channelId: 'channel-1',
        isActive: true,
        connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(
        /instanceName|provisioningKey|apiKey|webhookSecret/i,
      );
    });
  });
});
