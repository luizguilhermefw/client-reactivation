import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerInterestType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerInterestAssignmentService } from './customer-interest-assignment.service';

describe('CustomerInterestAssignmentService', () => {
  const companyId = 'company-1';
  const customerId = 'customer-1';
  const categoryId = 'category-1';
  const brandId = 'brand-1';
  const inactiveId = 'inactive-1';
  const category = {
    id: categoryId,
    type: CustomerInterestType.CATEGORY,
    name: 'Calçados',
    active: true,
  };
  const brand = {
    id: brandId,
    type: CustomerInterestType.BRAND,
    name: 'Ayla',
    active: true,
  };
  const inactiveBrand = {
    id: inactiveId,
    type: CustomerInterestType.BRAND,
    name: 'Marca antiga',
    active: false,
  };

  const txMock = {
    customer: { findFirst: jest.fn() },
    customerInterest: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    customerInterestOption: { findMany: jest.fn() },
  };
  const prismaMock = {
    customer: { findFirst: jest.fn() },
    customerInterest: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: CustomerInterestAssignmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomerInterestAssignmentService(
      prismaMock as unknown as PrismaService,
    );
    prismaMock.customer.findFirst.mockResolvedValue({ id: customerId });
    prismaMock.customerInterest.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(
      (operation: (tx: typeof txMock) => unknown) => operation(txMock),
    );
    txMock.customer.findFirst.mockResolvedValue({ id: customerId });
    txMock.customerInterest.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    txMock.customerInterestOption.findMany.mockResolvedValue([]);
    txMock.customerInterest.deleteMany.mockResolvedValue({ count: 0 });
    txMock.customerInterest.createMany.mockResolvedValue({ count: 0 });
  });

  it('returns categories and brands, including inactive associated options', async () => {
    prismaMock.customerInterest.findMany.mockResolvedValue([
      { interestOptionId: inactiveId, interestOption: inactiveBrand },
      { interestOptionId: categoryId, interestOption: category },
      { interestOptionId: brandId, interestOption: brand },
    ]);

    await expect(service.get(companyId, customerId)).resolves.toEqual({
      categories: [category],
      brands: [brand, inactiveBrand],
    });
    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
      where: { id: customerId, companyId },
      select: { id: true },
    });
    expect(prismaMock.customerInterest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId, customerId } }),
    );
  });

  it('returns empty groups when the customer has no assignments', async () => {
    await expect(service.get(companyId, customerId)).resolves.toEqual({
      categories: [],
      brands: [],
    });
  });

  it('returns 404 before reading assignments for another tenant customer', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(null);

    await expect(service.get(companyId, customerId)).rejects.toThrow(
      NotFoundException,
    );
    expect(prismaMock.customerInterest.findMany).not.toHaveBeenCalled();
  });

  it('atomically adds, removes and preserves assignments in one batch', async () => {
    txMock.customerInterest.findMany
      .mockReset()
      .mockResolvedValueOnce([
        { interestOptionId: categoryId },
        { interestOptionId: inactiveId },
      ])
      .mockResolvedValueOnce([
        { interestOptionId: inactiveId, interestOption: inactiveBrand },
        { interestOptionId: brandId, interestOption: brand },
      ]);
    txMock.customerInterestOption.findMany.mockResolvedValue([
      { id: inactiveId, active: false },
      { id: brandId, active: true },
    ]);

    await expect(
      service.update(companyId, customerId, [inactiveId, brandId]),
    ).resolves.toEqual({ categories: [], brands: [brand, inactiveBrand] });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(txMock.customerInterestOption.findMany).toHaveBeenCalledWith({
      where: { companyId, id: { in: [inactiveId, brandId] } },
      select: { id: true, active: true },
    });
    expect(txMock.customerInterest.deleteMany).toHaveBeenCalledWith({
      where: {
        companyId,
        customerId,
        interestOptionId: { in: [categoryId] },
      },
    });
    expect(txMock.customerInterest.createMany).toHaveBeenCalledWith({
      data: [{ companyId, customerId, interestOptionId: brandId }],
      skipDuplicates: true,
    });
  });

  it('retries only a Prisma P2034 serialization conflict', async () => {
    prismaMock.$transaction.mockRejectedValueOnce({ code: 'P2034' });

    await expect(service.update(companyId, customerId, [])).resolves.toEqual({
      categories: [],
      brands: [],
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(prismaMock.$transaction).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });

  it('does not retry or swallow unrelated transaction errors', async () => {
    const unrelatedError = new Error('unrelated failure');
    prismaMock.$transaction.mockRejectedValueOnce(unrelatedError);

    await expect(service.update(companyId, customerId, [])).rejects.toBe(
      unrelatedError,
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('limits repeated P2034 retries to three transaction attempts', async () => {
    const serializationError = { code: 'P2034' };
    prismaMock.$transaction.mockRejectedValue(serializationError);

    await expect(service.update(companyId, customerId, [])).rejects.toBe(
      serializationError,
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
  });

  it('accepts an empty replacement and removes every current assignment', async () => {
    txMock.customerInterest.findMany
      .mockReset()
      .mockResolvedValueOnce([{ interestOptionId: categoryId }])
      .mockResolvedValueOnce([]);

    await expect(service.update(companyId, customerId, [])).resolves.toEqual({
      categories: [],
      brands: [],
    });
    expect(txMock.customerInterest.deleteMany).toHaveBeenCalledWith({
      where: {
        companyId,
        customerId,
        interestOptionId: { in: [categoryId] },
      },
    });
    expect(txMock.customerInterest.createMany).not.toHaveBeenCalled();
  });

  it('is idempotent when the requested set is already assigned', async () => {
    txMock.customerInterest.findMany
      .mockReset()
      .mockResolvedValueOnce([{ interestOptionId: brandId }])
      .mockResolvedValueOnce([
        { interestOptionId: brandId, interestOption: brand },
      ]);
    txMock.customerInterestOption.findMany.mockResolvedValue([
      { id: brandId, active: true },
    ]);

    await service.update(companyId, customerId, [brandId]);

    expect(txMock.customerInterest.deleteMany).not.toHaveBeenCalled();
    expect(txMock.customerInterest.createMany).not.toHaveBeenCalled();
  });

  it('rejects adding an inactive option without partial mutations', async () => {
    txMock.customerInterestOption.findMany.mockResolvedValue([
      { id: inactiveId, active: false },
    ]);

    await expect(
      service.update(companyId, customerId, [inactiveId]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(txMock.customerInterest.deleteMany).not.toHaveBeenCalled();
    expect(txMock.customerInterest.createMany).not.toHaveBeenCalled();
  });

  it('allows an already assigned inactive option to be preserved or removed', async () => {
    txMock.customerInterest.findMany
      .mockReset()
      .mockResolvedValueOnce([{ interestOptionId: inactiveId }])
      .mockResolvedValueOnce([
        { interestOptionId: inactiveId, interestOption: inactiveBrand },
      ]);
    txMock.customerInterestOption.findMany.mockResolvedValue([
      { id: inactiveId, active: false },
    ]);
    await expect(
      service.update(companyId, customerId, [inactiveId]),
    ).resolves.toEqual({ categories: [], brands: [inactiveBrand] });

    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (operation: (tx: typeof txMock) => unknown) => operation(txMock),
    );
    txMock.customer.findFirst.mockResolvedValue({ id: customerId });
    txMock.customerInterest.findMany
      .mockResolvedValueOnce([{ interestOptionId: inactiveId }])
      .mockResolvedValueOnce([]);
    txMock.customerInterestOption.findMany.mockResolvedValue([]);
    txMock.customerInterest.deleteMany.mockResolvedValue({ count: 1 });

    await service.update(companyId, customerId, []);
    expect(txMock.customerInterest.deleteMany).toHaveBeenCalledWith({
      where: {
        companyId,
        customerId,
        interestOptionId: { in: [inactiveId] },
      },
    });
  });

  it('fails securely when a requested option is absent or belongs to another tenant', async () => {
    txMock.customerInterestOption.findMany.mockResolvedValue([
      { id: brandId, active: true },
    ]);

    const operation = service.update(companyId, customerId, [
      brandId,
      'other-tenant-option',
    ]);
    await expect(operation).rejects.toBeInstanceOf(BadRequestException);
    await expect(operation).rejects.toThrow(
      'Uma ou mais opções de interesse são inválidas.',
    );
    expect(txMock.customerInterestOption.findMany).toHaveBeenCalledWith({
      where: {
        companyId,
        id: { in: [brandId, 'other-tenant-option'] },
      },
      select: { id: true, active: true },
    });
    expect(txMock.customerInterest.deleteMany).not.toHaveBeenCalled();
    expect(txMock.customerInterest.createMany).not.toHaveBeenCalled();
  });

  it('returns 404 inside the transaction for a customer outside the tenant', async () => {
    txMock.customer.findFirst.mockResolvedValue(null);

    await expect(
      service.update(companyId, customerId, [brandId]),
    ).rejects.toThrow(NotFoundException);
    expect(txMock.customer.findFirst).toHaveBeenCalledWith({
      where: { id: customerId, companyId },
      select: { id: true },
    });
    expect(txMock.customerInterest.findMany).not.toHaveBeenCalled();
    expect(txMock.customerInterestOption.findMany).not.toHaveBeenCalled();
  });
});
