import { Injectable } from '@nestjs/common';
import { MessagingChannelStatus, MessagingProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { EvolutionInstanceTenantResolver } from './evolution-instance-tenant-resolver.interface';

@Injectable()
export class ConfiguredEvolutionInstanceTenantResolver implements EvolutionInstanceTenantResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCompanyId(instanceName: string): Promise<string | null> {
    const normalizedInstanceName = instanceName.trim();

    if (!normalizedInstanceName) {
      return null;
    }

    const channel = await this.prisma.messagingChannel.findFirst({
      where: {
        provider: MessagingProvider.EVOLUTION,
        instanceName: normalizedInstanceName,
        status: MessagingChannelStatus.ACTIVE,
      },
      select: {
        companyId: true,
      },
    });

    return channel?.companyId ?? null;
  }
}
