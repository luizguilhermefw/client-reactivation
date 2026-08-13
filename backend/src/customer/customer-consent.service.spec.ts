import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomerContactConsentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerConsentService } from './customer-consent.service';

describe('CustomerConsentService', () => {
  let service: CustomerConsentService;
  const now = new Date('2026-08-10T15:00:00.000Z');
  const companyId = 'company-1';
  const customerId = 'customer-1';
  const prismaMock = {
    customer: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerConsentService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get(CustomerConsentService);
    prismaMock.customer.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const mockCustomerReads = (
    contactConsentStatus: CustomerContactConsentStatus,
    consentGrantedAt: Date | null,
    optedOutAt: Date | null,
  ) => {
    prismaMock.customer.findFirst
      .mockResolvedValueOnce({ id: customerId })
      .mockResolvedValueOnce({
        id: customerId,
        contactConsentStatus,
        consentGrantedAt,
        optedOutAt,
      });
  };

  it('transitions UNKNOWN to GRANTED with a grant timestamp', async () => {
    mockCustomerReads(CustomerContactConsentStatus.GRANTED, now, null);

    const result = await service.updateConsent(
      companyId,
      customerId,
      CustomerContactConsentStatus.GRANTED,
    );

    expect(prismaMock.customer.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: customerId, companyId },
      select: { id: true },
    });
    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
      where: { id: customerId, companyId },
      data: {
        contactConsentStatus: CustomerContactConsentStatus.GRANTED,
        consentGrantedAt: now,
        optedOutAt: null,
      },
    });
    expect(result).toEqual({
      id: customerId,
      contactConsentStatus: CustomerContactConsentStatus.GRANTED,
      consentGrantedAt: now,
      optedOutAt: null,
    });
  });

  it('transitions GRANTED to OPTED_OUT while preserving consentGrantedAt', async () => {
    const previousGrant = new Date('2026-08-01T12:00:00.000Z');
    mockCustomerReads(
      CustomerContactConsentStatus.OPTED_OUT,
      previousGrant,
      now,
    );

    const result = await service.updateConsent(
      companyId,
      customerId,
      CustomerContactConsentStatus.OPTED_OUT,
    );

    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
      where: { id: customerId, companyId },
      data: {
        contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
        optedOutAt: now,
      },
    });
    expect(
      prismaMock.customer.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('consentGrantedAt');
    expect(result.consentGrantedAt).toEqual(previousGrant);
  });

  it('transitions OPTED_OUT to GRANTED with a renewed timestamp', async () => {
    mockCustomerReads(CustomerContactConsentStatus.GRANTED, now, null);

    await service.updateConsent(
      companyId,
      customerId,
      CustomerContactConsentStatus.GRANTED,
    );

    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          contactConsentStatus: CustomerContactConsentStatus.GRANTED,
          consentGrantedAt: now,
          optedOutAt: null,
        },
      }),
    );
  });

  it('rejects a manual transition to UNKNOWN', async () => {
    await expect(
      service.updateConsent(
        companyId,
        customerId,
        CustomerContactConsentStatus.UNKNOWN,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaMock.customer.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.customer.updateMany).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the customer does not exist', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(null);

    await expect(
      service.updateConsent(
        companyId,
        customerId,
        CustomerContactConsentStatus.GRANTED,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prismaMock.customer.updateMany).not.toHaveBeenCalled();
  });

  it('does not find or update a customer from another tenant', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(null);

    await expect(
      service.updateConsent(
        'other-company',
        customerId,
        CustomerContactConsentStatus.OPTED_OUT,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
      where: { id: customerId, companyId: 'other-company' },
      select: { id: true },
    });
    expect(prismaMock.customer.updateMany).not.toHaveBeenCalled();
  });

  it('requires id and companyId in the guarded update', async () => {
    mockCustomerReads(CustomerContactConsentStatus.OPTED_OUT, null, now);

    await service.updateConsent(
      companyId,
      customerId,
      CustomerContactConsentStatus.OPTED_OUT,
    );

    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: customerId, companyId },
      }),
    );
  });

  it('throws NotFoundException when the guarded update does not affect one row', async () => {
    prismaMock.customer.findFirst.mockResolvedValueOnce({ id: customerId });
    prismaMock.customer.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateConsent(
        companyId,
        customerId,
        CustomerContactConsentStatus.GRANTED,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates only consent fields', async () => {
    mockCustomerReads(CustomerContactConsentStatus.GRANTED, now, null);

    await service.updateConsent(
      companyId,
      customerId,
      CustomerContactConsentStatus.GRANTED,
    );

    expect(
      Object.keys(prismaMock.customer.updateMany.mock.calls[0][0].data).sort(),
    ).toEqual(
      ['contactConsentStatus', 'consentGrantedAt', 'optedOutAt'].sort(),
    );
  });
});
