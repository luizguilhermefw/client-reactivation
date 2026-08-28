import {
  AutomationType,
  OutboundMessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const companyId = 'company-a';
  const createdAt = new Date('2026-08-28T12:00:00.000Z');
  const prismaMock = {
    automation: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    customer: { count: jest.fn() },
    outboundMessage: { count: jest.fn() },
  };
  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.automation.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4);
    prismaMock.customer.count.mockResolvedValue(18);
    prismaMock.outboundMessage.count.mockResolvedValue(27);
    prismaMock.automation.findMany.mockResolvedValue([
      {
        id: 'automation-1',
        name: 'Reativação recente',
        type: AutomationType.REACTIVATION,
        isActive: true,
        createdAt,
      },
    ]);
    service = new DashboardService(
      prismaMock as unknown as PrismaService,
    );
  });

  it('returns only tenant-scoped pilot metrics and safe recent automation fields', async () => {
    await expect(service.getSummary(companyId)).resolves.toEqual({
      activeAutomations: 3,
      contacts: 18,
      messagesSent: 27,
      campaigns: 4,
      recentAutomations: [
        {
          id: 'automation-1',
          name: 'Reativação recente',
          type: AutomationType.REACTIVATION,
          isActive: true,
          createdAt,
        },
      ],
    });

    expect(prismaMock.automation.count).toHaveBeenNthCalledWith(1, {
      where: {
        companyId,
        isActive: true,
        type: { not: AutomationType.CAMPAIGN },
      },
    });
    expect(prismaMock.customer.count).toHaveBeenCalledWith({
      where: { companyId },
    });
    expect(prismaMock.outboundMessage.count).toHaveBeenCalledWith({
      where: {
        companyId,
        status: OutboundMessageStatus.SENT,
      },
    });
    expect(prismaMock.automation.count).toHaveBeenNthCalledWith(2, {
      where: {
        companyId,
        type: AutomationType.CAMPAIGN,
      },
    });
    expect(prismaMock.automation.findMany).toHaveBeenCalledWith({
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
    });
  });

  it('does not include customer data or message content in the summary', async () => {
    const result = await service.getSummary(companyId);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(
      /phone|recipientPhone|content|"message"/i,
    );
    expect(Object.keys(result)).toEqual([
      'activeAutomations',
      'contacts',
      'messagesSent',
      'campaigns',
      'recentAutomations',
    ]);
  });

  it('propagates database errors instead of silently returning false zeroes', async () => {
    const databaseError = new Error('database unavailable');
    prismaMock.customer.count.mockRejectedValue(databaseError);

    await expect(service.getSummary(companyId)).rejects.toBe(databaseError);
  });
});
