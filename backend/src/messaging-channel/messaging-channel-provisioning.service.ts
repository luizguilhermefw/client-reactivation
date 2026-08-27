import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EntitlementFeature,
  MessagingChannel,
  MessagingChannelConnectionStatus,
  MessagingChannelStatus,
  MessagingProvider,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { EvolutionWebhookProvisioningService } from '../evolution-webhook-provisioning/evolution-webhook-provisioning.service';
import type {
  EvolutionInstanceProvisioningClient,
  EvolutionInstanceSnapshot,
} from './evolution-instance-provisioning-client.interface';
import { EVOLUTION_INSTANCE_PROVISIONING_CLIENT } from './evolution-instance-provisioning-client.token';
import {
  isValidCustomerPhone,
  normalizeCustomerPhone,
} from '../customer/customer-normalization';

export interface WhatsappChannelResponse {
  channelId: string;
  connectionStatus: MessagingChannelConnectionStatus;
  qrCode?: string;
}

export interface WhatsappChannelConnectionResponse {
  channelId: string;
  connectionStatus: MessagingChannelConnectionStatus;
  connectedPhone: string | null;
  isActive: boolean;
}

export interface WhatsappChannelPairingCodeResponse {
  channelId: string;
  connectionStatus: MessagingChannelConnectionStatus;
  pairingCode?: string;
}

export interface WhatsappChannelListResponse {
  limit: number;
  used: number;
  available: number;
  channels: Array<{
    id: string;
    connectionStatus: MessagingChannelConnectionStatus;
    connectedPhone: string | null;
    isActive: boolean;
  }>;
}

@Injectable()
export class MessagingChannelProvisioningService {
  private static readonly MAX_TRANSACTION_ATTEMPTS = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementService: EntitlementService,
    private readonly webhookProvisioningService: EvolutionWebhookProvisioningService,
    @Inject(EVOLUTION_INSTANCE_PROVISIONING_CLIENT)
    private readonly evolutionClient: EvolutionInstanceProvisioningClient,
  ) {}

  async provision(
    companyId: string,
    provisioningKey: string,
  ): Promise<WhatsappChannelResponse> {
    const channel = await this.reserveChannel(companyId, provisioningKey);

    try {
      const instance = await this.ensureInstance(channel.instanceName);
      await this.webhookProvisioningService.ensureConfiguredForInstance({
        companyId,
        instanceName: channel.instanceName,
      });

      const snapshot =
        instance.qrCode || instance.connectionStatus === 'CONNECTED'
          ? instance
          : await this.evolutionClient.getQrCode(channel.instanceName);

      if (snapshot.connectionStatus !== 'CONNECTED' && !snapshot.qrCode) {
        throw new ServiceUnavailableException(
          'WhatsApp QR code is temporarily unavailable',
        );
      }

      const synchronized = await this.synchronizeChannel(
        companyId,
        channel,
        snapshot,
      );
      return {
        channelId: synchronized.id,
        connectionStatus: synchronized.connectionStatus,
        ...(snapshot.qrCode ? { qrCode: snapshot.qrCode } : {}),
      };
    } catch {
      await this.markProvisioningError(companyId, channel.id);
      throw new ServiceUnavailableException(
        'WhatsApp channel provisioning is temporarily unavailable',
      );
    }
  }

  async getQrCode(
    companyId: string,
    channelId: string,
  ): Promise<WhatsappChannelResponse> {
    const channel = await this.findTenantChannel(companyId, channelId);

    try {
      const snapshot = await this.evolutionClient.getQrCode(
        channel.instanceName,
      );
      if (snapshot.connectionStatus !== 'CONNECTED' && !snapshot.qrCode) {
        throw new Error('QR unavailable');
      }

      const synchronized = await this.synchronizeChannel(
        companyId,
        channel,
        snapshot,
      );
      return {
        channelId: synchronized.id,
        connectionStatus: synchronized.connectionStatus,
        ...(snapshot.qrCode ? { qrCode: snapshot.qrCode } : {}),
      };
    } catch {
      await this.markProvisioningError(companyId, channel.id);
      throw new ServiceUnavailableException(
        'WhatsApp QR code is temporarily unavailable',
      );
    }
  }

  async getConnection(
    companyId: string,
    channelId: string,
  ): Promise<WhatsappChannelConnectionResponse> {
    const channel = await this.findTenantChannel(companyId, channelId);
    let snapshot: EvolutionInstanceSnapshot | null;

    try {
      snapshot = await this.evolutionClient.getConnectionState(
        channel.instanceName,
      );
    } catch {
      throw new ServiceUnavailableException(
        'WhatsApp connection state is temporarily unavailable',
      );
    }

    try {
      const synchronized = await this.synchronizeChannel(
        companyId,
        channel,
        snapshot,
      );
      return this.connectionResponse(synchronized);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException(
        'WhatsApp connection state could not be synchronized',
      );
    }
  }

  async getPairingCode(
    companyId: string,
    channelId: string,
    phone: string,
  ): Promise<WhatsappChannelPairingCodeResponse> {
    const normalizedPhone =
      typeof phone === 'string' ? normalizeCustomerPhone(phone) : '';
    if (!isValidCustomerPhone(normalizedPhone)) {
      throw new BadRequestException('A valid Brazilian phone is required');
    }

    const channel = await this.findTenantChannel(companyId, channelId);
    if (
      channel.connectionStatus === MessagingChannelConnectionStatus.CONNECTED
    ) {
      return {
        channelId: channel.id,
        connectionStatus: channel.connectionStatus,
      };
    }

    try {
      const snapshot = await this.evolutionClient.getPairingCode(
        channel.instanceName,
        normalizedPhone,
      );
      const connectionStatus =
        MessagingChannelConnectionStatus[snapshot.connectionStatus];
      const synchronized = await this.prisma.messagingChannel.updateMany({
        where: {
          id: channel.id,
          companyId,
          provider: MessagingProvider.EVOLUTION,
        },
        data: {
          connectionStatus,
          lastConnectionCheckAt: new Date(),
        },
      });
      if (synchronized.count !== 1) throw new Error('Channel state changed');

      return {
        channelId: channel.id,
        connectionStatus,
        pairingCode: snapshot.pairingCode,
      };
    } catch {
      throw new ServiceUnavailableException(
        'WhatsApp pairing code is temporarily unavailable',
      );
    }
  }

  async list(companyId: string): Promise<WhatsappChannelListResponse> {
    const [limit, channels] = await Promise.all([
      this.entitlementService.getLimit(
        companyId,
        EntitlementFeature.WHATSAPP_CHANNELS,
      ),
      this.prisma.messagingChannel.findMany({
        where: { companyId, provider: MessagingProvider.EVOLUTION },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          connectionStatus: true,
          connectedPhone: true,
          status: true,
        },
      }),
    ]);

    const used = channels.length;
    return {
      limit,
      used,
      available: Math.max(0, limit - used),
      channels: channels.map((channel) => ({
        id: channel.id,
        connectionStatus: channel.connectionStatus,
        connectedPhone: channel.connectedPhone,
        isActive: channel.status === MessagingChannelStatus.ACTIVE,
      })),
    };
  }

  private async ensureInstance(
    instanceName: string,
  ): Promise<EvolutionInstanceSnapshot> {
    const existing = await this.evolutionClient.inspectInstance(instanceName);
    if (existing) return existing;

    try {
      return await this.evolutionClient.createInstance(instanceName);
    } catch {
      // A timeout or an "already exists" response may happen after Evolution
      // persisted the instance. Inspect the same opaque name before failing.
      const reconciled =
        await this.evolutionClient.inspectInstance(instanceName);
      if (reconciled) return reconciled;
      throw new Error('Evolution instance could not be reconciled');
    }
  }

  private async reserveChannel(
    companyId: string,
    provisioningKey: string,
  ): Promise<MessagingChannel> {
    for (
      let attempt = 1;
      attempt <= MessagingChannelProvisioningService.MAX_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const existing = await transaction.messagingChannel.findUnique({
              where: {
                companyId_provisioningKey: { companyId, provisioningKey },
              },
            });
            if (existing) return existing;

            const entitlement = await transaction.companyEntitlement.findUnique(
              {
                where: {
                  companyId_feature: {
                    companyId,
                    feature: EntitlementFeature.WHATSAPP_CHANNELS,
                  },
                },
                select: { limit: true },
              },
            );
            const limit = entitlement?.limit ?? 0;
            const used = await transaction.messagingChannel.count({
              where: { companyId, provider: MessagingProvider.EVOLUTION },
            });

            if (used >= limit) {
              throw new ConflictException(
                'WhatsApp channel entitlement limit reached',
              );
            }

            return transaction.messagingChannel.create({
              data: {
                companyId,
                provider: MessagingProvider.EVOLUTION,
                instanceName: this.generateInstanceName(),
                status: MessagingChannelStatus.INACTIVE,
                connectionStatus: MessagingChannelConnectionStatus.PROVISIONING,
                provisioningKey,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (error instanceof ConflictException) throw error;

        if (this.hasPrismaCode(error, 'P2002')) {
          const existing = await this.prisma.messagingChannel.findUnique({
            where: {
              companyId_provisioningKey: { companyId, provisioningKey },
            },
          });
          if (existing) return existing;
        }

        if (
          attempt <
            MessagingChannelProvisioningService.MAX_TRANSACTION_ATTEMPTS &&
          (this.hasPrismaCode(error, 'P2002') ||
            this.hasPrismaCode(error, 'P2034'))
        ) {
          continue;
        }

        throw new ServiceUnavailableException(
          'WhatsApp channel reservation is temporarily unavailable',
        );
      }
    }

    throw new ServiceUnavailableException(
      'WhatsApp channel reservation is temporarily unavailable',
    );
  }

  private async synchronizeChannel(
    companyId: string,
    channel: MessagingChannel,
    snapshot: EvolutionInstanceSnapshot,
  ): Promise<MessagingChannel> {
    const connectionStatus =
      MessagingChannelConnectionStatus[snapshot.connectionStatus];
    const result = await this.prisma.messagingChannel.updateMany({
      where: {
        id: channel.id,
        companyId,
        provider: MessagingProvider.EVOLUTION,
      },
      data: {
        connectionStatus,
        lastConnectionCheckAt: new Date(),
        ...(snapshot.connectedPhone
          ? { connectedPhone: snapshot.connectedPhone }
          : {}),
      },
    });
    if (result.count !== 1) throw new NotFoundException('Channel not found');

    return {
      ...channel,
      connectionStatus,
      ...(snapshot.connectedPhone
        ? { connectedPhone: snapshot.connectedPhone }
        : {}),
    };
  }

  private async findTenantChannel(
    companyId: string,
    channelId: string,
  ): Promise<MessagingChannel> {
    const channel = await this.prisma.messagingChannel.findFirst({
      where: {
        id: channelId,
        companyId,
        provider: MessagingProvider.EVOLUTION,
      },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  private async markProvisioningError(
    companyId: string,
    channelId: string,
  ): Promise<void> {
    try {
      await this.prisma.messagingChannel.updateMany({
        where: {
          id: channelId,
          companyId,
          provider: MessagingProvider.EVOLUTION,
        },
        data: {
          connectionStatus: MessagingChannelConnectionStatus.ERROR,
          lastConnectionCheckAt: new Date(),
        },
      });
    } catch {
      // Preserve the original safe provider error if state synchronization fails.
    }
  }

  private connectionResponse(
    channel: MessagingChannel,
  ): WhatsappChannelConnectionResponse {
    return {
      channelId: channel.id,
      connectionStatus: channel.connectionStatus,
      connectedPhone: channel.connectedPhone,
      isActive: channel.status === MessagingChannelStatus.ACTIVE,
    };
  }

  private generateInstanceName(): string {
    return `ayla_${randomBytes(12).toString('hex')}`;
  }

  private hasPrismaCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }
}
