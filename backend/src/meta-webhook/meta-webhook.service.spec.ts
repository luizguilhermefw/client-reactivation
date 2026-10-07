import { ServiceUnavailableException } from '@nestjs/common';
import { OutboundDeliveryStatus as Status } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { canAdvanceDelivery } from './meta-delivery-transition';
import { parseMetaStatuses } from './meta-status-parser';
import { MetaWebhookService } from './meta-webhook.service';

const envelope = (statuses: unknown[]) => ({
  entry: [{ changes: [{ value: { statuses } }] }],
});

describe('MetaWebhookService', () => {
  const prisma = {
    outboundMessage: { findMany: jest.fn(), updateMany: jest.fn() },
  };
  const service = new MetaWebhookService(prisma as unknown as PrismaService);
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.outboundMessage.findMany.mockResolvedValue([
      {
        id: 'internal',
        companyId: 'tenant',
        deliveryStatus: null,
        sentAt: null,
      },
    ]);
    prisma.outboundMessage.updateMany.mockResolvedValue({ count: 1 });
  });
  it.each(['sent', 'delivered', 'read', 'failed'])(
    'applies %s without changing queue status or MessageLog',
    async (status) => {
      await service.handle(
        envelope([
          {
            id: 'wamid.test',
            status,
            timestamp: '1700000000',
            companyId: 'untrusted',
            errors: [{ code: 131000, message: 'secret payload' }],
          },
        ]),
      );
      expect(prisma.outboundMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: 'META_CLOUD', providerMessageId: 'wamid.test' },
          take: 2,
        }),
      );
      const args = prisma.outboundMessage.updateMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        id: 'internal',
        companyId: 'tenant',
        deliveryStatus: null,
      });
      expect(args.data.deliveryStatus).toBe(status.toUpperCase());
      expect(args.data).not.toHaveProperty('status');
      expect(JSON.stringify(args)).not.toContain('secret payload');
      if (status === 'failed')
        expect(args.data).toMatchObject({
          lastErrorCode: 'META_131000',
          lastError: 'Message delivery failed',
        });
      if (status === 'delivered')
        expect(args.data.deliveredAt).toEqual(new Date(1700000000000));
      if (status === 'read')
        expect(args.data.readAt).toEqual(new Date(1700000000000));
    },
  );
  it.each([
    [Status.READ, 'delivered'],
    [Status.READ, 'sent'],
    [Status.READ, 'failed'],
    [Status.DELIVERED, 'sent'],
    [Status.DELIVERED, 'failed'],
    [Status.FAILED, 'sent'],
    [Status.SENT, 'sent'],
    [Status.READ, 'read'],
  ])('does not regress or duplicate %s with %s', async (current, status) => {
    prisma.outboundMessage.findMany.mockResolvedValue([
      {
        id: 'internal',
        companyId: 'tenant',
        deliveryStatus: current,
        sentAt: new Date(),
      },
    ]);
    await service.handle(envelope([{ id: 'wamid.test', status }]));
    expect(prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });
  it('ignores unknown messages without creating records', async () => {
    prisma.outboundMessage.findMany.mockResolvedValue([]);
    await service.handle(envelope([{ id: 'unknown', status: 'read' }]));
    expect(prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });
  it('rejects ambiguous correlation without updating any tenant', async () => {
    prisma.outboundMessage.findMany.mockResolvedValue([{}, {}]);
    await expect(
      service.handle(envelope([{ id: 'ambiguous', status: 'sent' }])),
    ).rejects.toThrow('Webhook message correlation is ambiguous');
    expect(prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });
  it('ignores malformed individual events and processes all valid events', async () => {
    await service.handle(
      envelope([
        null,
        {},
        { id: 'x', status: 'unknown' },
        { id: 'a', status: 'sent' },
        { id: 'b', status: 'read' },
      ]),
    );
    expect(prisma.outboundMessage.updateMany).toHaveBeenCalledTimes(2);
  });
  it('accepts empty and malformed payloads without exposing data', async () => {
    for (const payload of [
      null,
      [],
      {},
      { messages: ['private'] },
      envelope([{ id: 'x', status: '__proto__' }]),
    ])
      await service.handle(payload);
    expect(prisma.outboundMessage.findMany).not.toHaveBeenCalled();
  });
  it('sanitizes infrastructure errors and signals redelivery', async () => {
    prisma.outboundMessage.findMany.mockRejectedValue(
      new Error('private database credential'),
    );
    await expect(
      service.handle(envelope([{ id: 'a', status: 'read' }])),
    ).rejects.toThrow('Webhook status processing is temporarily unavailable');
  });
  it('does not silently lose a concurrent forward transition', async () => {
    prisma.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.handle(envelope([{ id: 'a', status: 'read' }])),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('preserves existing sentAt', async () => {
    prisma.outboundMessage.findMany.mockResolvedValue([
      {
        id: 'internal',
        companyId: 'tenant',
        deliveryStatus: null,
        sentAt: new Date(),
      },
    ]);
    await service.handle(envelope([{ id: 'a', status: 'sent' }]));
    expect(
      prisma.outboundMessage.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('sentAt');
  });
  it('centralizes every delivery transition', () => {
    for (const next of Object.values(Status)) {
      expect(canAdvanceDelivery(null, next)).toBe(true);
      expect(canAdvanceDelivery(Status.READ, next)).toBe(false);
      expect(canAdvanceDelivery(Status.FAILED, next)).toBe(false);
    }
    expect(canAdvanceDelivery(Status.SENT, Status.FAILED)).toBe(true);
    expect(canAdvanceDelivery(Status.SENT, Status.READ)).toBe(true);
    expect(canAdvanceDelivery(Status.SENT, Status.DELIVERED)).toBe(true);
    expect(canAdvanceDelivery(Status.DELIVERED, Status.READ)).toBe(true);
  });
  it('retains no raw Meta error and discards invalid timestamps', () => {
    expect(
      parseMetaStatuses(
        envelope([
          {
            id: 'a',
            status: 'failed',
            timestamp: 'invalid',
            errors: [{ code: 'secret', message: 'secret' }],
          },
        ]),
      ),
    ).toEqual([{ providerMessageId: 'a', status: 'FAILED' }]);
  });
});
