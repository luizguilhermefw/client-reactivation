import {
  BadRequestException,
  ConflictException,
  Injectable,
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

export interface MessagingChannelRoutingSelection {
  messagingChannelId: string;
}

export interface MessagingChannelRoutingStatusResult {
  channelId: string;
  isActive: boolean;
  connectionStatus: MessagingChannelConnectionStatus;
}

@Injectable()
export class MessagingChannelRoutingService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForEnqueue(
    companyId: string,
    requestedChannelId?: string,
    transaction?: Prisma.TransactionClient,
    messageType: OutboundMessageType = OutboundMessageType.TEXT,
  ): Promise<MessagingChannelRoutingSelection> {
    const normalizedCompanyId =
      typeof companyId === 'string' ? companyId.trim() : '';
    if (!normalizedCompanyId) {
      throw new BadRequestException('Company context is required');
    }

    const client = transaction ?? this.prisma;
    if (!Object.values(OutboundMessageType).includes(messageType)) {
      throw new BadRequestException('Message type is invalid');
    }
    if (
      messageType === OutboundMessageType.TEMPLATE &&
      requestedChannelId === undefined
    ) {
      throw new BadRequestException('Messaging channel is required');
    }
    const provider =
      messageType === OutboundMessageType.TEMPLATE
        ? MessagingProvider.META_CLOUD
        : MessagingProvider.EVOLUTION;
    if (requestedChannelId !== undefined) {
      if (typeof requestedChannelId !== 'string') {
        throw new BadRequestException('Messaging channel is required');
      }

      const normalizedChannelId = requestedChannelId.trim();
      if (!normalizedChannelId) {
        throw new BadRequestException('Messaging channel is required');
      }

      const channel = await client.messagingChannel.findFirst({
        where: {
          id: normalizedChannelId,
          companyId: normalizedCompanyId,
          provider,
          status: MessagingChannelStatus.ACTIVE,
        },
        select: { id: true },
      });

      if (!channel) {
        throw new NotFoundException('Active messaging channel not found');
      }

      return { messagingChannelId: channel.id };
    }

    const activeChannels = await client.messagingChannel.findMany({
      where: {
        companyId: normalizedCompanyId,
        provider,
        status: MessagingChannelStatus.ACTIVE,
      },
      take: 2,
      select: { id: true },
    });

    if (activeChannels.length === 0) {
      throw new BadRequestException('No active messaging channel is available');
    }
    if (activeChannels.length !== 1) {
      throw new BadRequestException('Messaging channel selection is required');
    }

    return { messagingChannelId: activeChannels[0].id };
  }

  async updateRoutingStatus(
    companyId: string,
    channelId: string,
    isActive: boolean,
  ): Promise<MessagingChannelRoutingStatusResult> {
    const normalizedCompanyId = companyId?.trim();
    const normalizedChannelId = channelId?.trim();
    if (!normalizedCompanyId || !normalizedChannelId) {
      throw new BadRequestException('Messaging channel context is required');
    }

    const channel = await this.prisma.messagingChannel.findFirst({
      where: {
        id: normalizedChannelId,
        companyId: normalizedCompanyId,
        provider: MessagingProvider.EVOLUTION,
      },
      select: {
        id: true,
        connectionStatus: true,
      },
    });

    if (!channel) {
      throw new NotFoundException('Messaging channel not found');
    }

    if (
      isActive &&
      channel.connectionStatus !== MessagingChannelConnectionStatus.CONNECTED
    ) {
      throw new ConflictException('Messaging channel is not connected');
    }

    const update = await this.prisma.messagingChannel.updateMany({
      where: {
        id: channel.id,
        companyId: normalizedCompanyId,
        provider: MessagingProvider.EVOLUTION,
        ...(isActive
          ? { connectionStatus: MessagingChannelConnectionStatus.CONNECTED }
          : {}),
      },
      data: {
        status: isActive
          ? MessagingChannelStatus.ACTIVE
          : MessagingChannelStatus.INACTIVE,
      },
    });

    if (update.count !== 1) {
      if (isActive) {
        throw new ConflictException('Messaging channel is not connected');
      }
      throw new NotFoundException('Messaging channel not found');
    }

    return {
      channelId: channel.id,
      isActive,
      connectionStatus: channel.connectionStatus,
    };
  }
}
