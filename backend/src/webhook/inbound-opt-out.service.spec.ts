import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomerContactConsentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerConsentService } from '../customer/customer-consent.service';
import { InboundOptOutService } from './inbound-opt-out.service';
import type { InboundMessage } from './types/inbound-message';

describe('InboundOptOutService', () => {
  let service: InboundOptOutService;
  const companyId = 'company-1';
  const customerId = 'customer-1';
  const prismaMock = {
    customer: {
      findMany: jest.fn(),
    },
  };
  const customerConsentServiceMock = {
    updateConsent: jest.fn(),
  };
  const inboundMessage: InboundMessage = {
    provider: 'EVOLUTION',
    instanceName: 'tenant-instance',
    providerMessageId: 'provider-message-1',
    phone: '5545999999999',
    text: 'PARAR',
    fromMe: false,
    receivedAt: new Date('2026-08-11T12:00:00.000Z'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundOptOutService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: CustomerConsentService,
          useValue: customerConsentServiceMock,
        },
      ],
    }).compile();

    service = module.get(InboundOptOutService);
    prismaMock.customer.findMany.mockResolvedValue([
      {
        id: customerId,
        contactConsentStatus: CustomerContactConsentStatus.UNKNOWN,
      },
    ]);
    customerConsentServiceMock.updateConsent.mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('applies PARAR from UNKNOWN through CustomerConsentService', async () => {
    await expect(service.process(companyId, inboundMessage)).resolves.toBe(
      'opt-out-applied',
    );
    expect(customerConsentServiceMock.updateConsent).toHaveBeenCalledWith(
      companyId,
      customerId,
      CustomerContactConsentStatus.OPTED_OUT,
    );
  });

  it('applies SAIR from GRANTED without duplicating consent updates', async () => {
    prismaMock.customer.findMany.mockResolvedValue([
      {
        id: customerId,
        contactConsentStatus: CustomerContactConsentStatus.GRANTED,
      },
    ]);

    await expect(
      service.process(companyId, { ...inboundMessage, text: 'SAIR' }),
    ).resolves.toBe('opt-out-applied');
    expect(customerConsentServiceMock.updateConsent).toHaveBeenCalledWith(
      companyId,
      customerId,
      CustomerContactConsentStatus.OPTED_OUT,
    );
  });

  it.each(['CANCELAR', 'cancelar', '  CANCELAR  '])(
    'accepts exact command variant %p',
    async (text) => {
      await expect(
        service.process(companyId, { ...inboundMessage, text }),
      ).resolves.toBe('opt-out-applied');
    },
  );

  it('does not query or change Customer for a common message', async () => {
    await expect(
      service.process(companyId, {
        ...inboundMessage,
        text: 'quero parar',
      }),
    ).resolves.toBe('not-opt-out-command');

    expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
    expect(customerConsentServiceMock.updateConsent).not.toHaveBeenCalled();
  });

  it('ignores a customer that is not found without throwing', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    await expect(service.process(companyId, inboundMessage)).resolves.toBe(
      'customer-not-found',
    );
    expect(customerConsentServiceMock.updateConsent).not.toHaveBeenCalled();
  });

  it('never changes a customer from another tenant', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    await service.process('resolved-company', inboundMessage);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'resolved-company',
          phone: { in: ['5545999999999', '554599999999'] },
        },
      }),
    );
    expect(customerConsentServiceMock.updateConsent).not.toHaveBeenCalled();
  });

  it('looks up at most two customers using companyId and normalized phone', async () => {
    await service.process(companyId, inboundMessage);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
      where: {
        companyId,
        phone: { in: ['5545999999999', '554599999999'] },
      },
      take: 2,
      select: {
        id: true,
        contactConsentStatus: true,
      },
    });
  });

  it('finds a legacy Customer when Evolution sends the equivalent ninth-digit mobile', async () => {
    const currentFormMessage = {
      ...inboundMessage,
      phone: '5545999029181',
    };

    await expect(service.process(companyId, currentFormMessage)).resolves.toBe(
      'opt-out-applied',
    );

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
      where: {
        companyId,
        phone: { in: ['5545999029181', '554599029181'] },
      },
      take: 2,
      select: {
        id: true,
        contactConsentStatus: true,
      },
    });
    expect(customerConsentServiceMock.updateConsent).toHaveBeenCalledWith(
      companyId,
      customerId,
      CustomerContactConsentStatus.OPTED_OUT,
    );
  });

  it('fails closed when the phone is ambiguous inside the tenant', async () => {
    prismaMock.customer.findMany.mockResolvedValue([
      {
        id: 'customer-1',
        contactConsentStatus: CustomerContactConsentStatus.UNKNOWN,
      },
      {
        id: 'customer-2',
        contactConsentStatus: CustomerContactConsentStatus.GRANTED,
      },
    ]);

    await expect(service.process(companyId, inboundMessage)).resolves.toBe(
      'ambiguous-customer',
    );
    expect(customerConsentServiceMock.updateConsent).not.toHaveBeenCalled();
  });

  it('preserves optedOutAt when Customer is already OPTED_OUT', async () => {
    prismaMock.customer.findMany.mockResolvedValue([
      {
        id: customerId,
        contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
      },
    ]);

    await expect(service.process(companyId, inboundMessage)).resolves.toBe(
      'already-opted-out',
    );
    expect(customerConsentServiceMock.updateConsent).not.toHaveBeenCalled();
  });

  it('does not expose phone or message text in operational logs', async () => {
    const loggerSpy = jest.spyOn(Logger.prototype, 'log');

    await service.process(companyId, inboundMessage);

    const logs = JSON.stringify(loggerSpy.mock.calls);
    expect(logs).not.toContain(inboundMessage.phone);
    expect(logs).not.toContain(inboundMessage.text);
  });
});
