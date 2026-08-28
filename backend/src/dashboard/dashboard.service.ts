import { Injectable } from '@nestjs/common';
import {
  AutomationType,
  OutboundMessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type DashboardRecentAutomationType =
  | typeof AutomationType.REACTIVATION
  | typeof AutomationType.BIRTHDAY
  | typeof AutomationType.MAINTENANCE;

export interface DashboardRecentAutomation {
  id: string;
  name: string;
  type: DashboardRecentAutomationType;
  isActive: boolean;
  createdAt: Date;
}

export interface DashboardSummary {
  activeAutomations: number;
  contacts: number;
  messagesSent: number;
  campaigns: number;
  recentAutomations: DashboardRecentAutomation[];
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(companyId: string): Promise<DashboardSummary> {
    const [
      activeAutomations,
      contacts,
      messagesSent,
      campaigns,
      recentAutomations,
    ] = await Promise.all([
      this.prisma.automation.count({
        where: {
          companyId,
          isActive: true,
          type: { not: AutomationType.CAMPAIGN },
        },
      }),
      this.prisma.customer.count({ where: { companyId } }),
      this.prisma.outboundMessage.count({
        where: {
          companyId,
          status: OutboundMessageStatus.SENT,
        },
      }),
      this.prisma.automation.count({
        where: {
          companyId,
          type: AutomationType.CAMPAIGN,
        },
      }),
      this.prisma.automation.findMany({
        where: {
          companyId,
          type: { not: AutomationType.CAMPAIGN },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          type: true,
          isActive: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      activeAutomations,
      contacts,
      messagesSent,
      campaigns,
      recentAutomations: recentAutomations as DashboardRecentAutomation[],
    };
  }
}
