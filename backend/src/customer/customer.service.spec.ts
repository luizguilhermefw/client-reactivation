import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  CustomerContactConsentStatus,
  CustomerGender,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerService } from './customer.service';
import { CustomerFilterDto } from './dto/customer-filter.dto';

describe('CustomerService', () => {
  const companyId = 'company-1';
  const customer = {
    id: 'customer-1',
    companyId,
    name: 'Maria Ávila',
    phone: '5545999999999',
    gender: CustomerGender.FEMALE,
    city: 'Foz do Iguaçu',
    state: 'PR',
    birthDate: new Date('1991-08-13T00:00:00.000Z'),
    lastPurchaseDate: new Date('2026-07-01T00:00:00.000Z'),
    isActiveForAutomation: true,
    contactConsentStatus: CustomerContactConsentStatus.GRANTED,
    consentGrantedAt: null,
    optedOutAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  };
  const prismaMock = {
    customer: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  let service: CustomerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomerService(prismaMock as unknown as PrismaService);
    prismaMock.customer.findFirst.mockResolvedValue(null);
    prismaMock.customer.create.mockResolvedValue(customer);
    prismaMock.customer.findMany.mockResolvedValue([customer]);
    prismaMock.customer.count.mockResolvedValue(1);
    prismaMock.customer.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation(
      (operations: Array<Promise<unknown>>) => Promise.all(operations),
    );
  });

  it('creates Customer with normalized gender, city and state', async () => {
    await service.create(
      {
        name: customer.name,
        phone: '(45) 99999-9999',
        gender: CustomerGender.FEMALE,
        city: '  Foz   do Iguaçu  ',
        state: ' pr ',
      },
      companyId,
    );

    expect(prismaMock.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        phone: customer.phone,
        gender: CustomerGender.FEMALE,
        city: 'Foz do Iguaçu',
        state: 'PR',
      }),
    });
  });

  it('creates omitted profile fields safely and never invents lastPurchaseDate', async () => {
    await service.create(
      { name: customer.name, phone: customer.phone },
      companyId,
    );

    const data = prismaMock.customer.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('gender');
    expect(data).not.toHaveProperty('city');
    expect(data).not.toHaveProperty('state');
    expect(data.lastPurchaseDate).toBeNull();
  });

  it('preserves an informed lastPurchaseDate on create', async () => {
    await service.create(
      {
        name: customer.name,
        phone: customer.phone,
        lastPurchaseDate: '2026-07-01',
      },
      companyId,
    );

    expect(prismaMock.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lastPurchaseDate: new Date('2026-07-01'),
      }),
    });
  });

  it('normalizes updates and allows city/state to be cleared with null', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(customer);

    await service.update(
      customer.id,
      { gender: CustomerGender.OTHER, city: null, state: null },
      companyId,
    );

    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
      where: { id: customer.id, companyId },
      data: { gender: CustomerGender.OTHER, city: null, state: null },
    });
  });

  it('turns empty city/state into null and uppercases state', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(customer);

    await service.update(
      customer.id,
      { city: '   ', state: ' sp ' },
      companyId,
    );

    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { city: null, state: 'SP' } }),
    );
  });

  it('clears lastPurchaseDate with null', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(customer);

    await service.update(customer.id, { lastPurchaseDate: null }, companyId);

    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
      where: { id: customer.id, companyId },
      data: { lastPurchaseDate: null },
    });
  });

  it('does not change lastPurchaseDate when update omits it', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(customer);

    await service.update(customer.id, { name: 'Updated' }, companyId);

    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
      where: { id: customer.id, companyId },
      data: { name: 'Updated' },
    });
  });

  it('rejects invalid UF even when called outside the controller', async () => {
    await expect(
      service.create(
        { name: customer.name, phone: customer.phone, state: 'ZZ' },
        companyId,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prismaMock.customer.create).not.toHaveBeenCalled();
  });

  it('keeps phone uniqueness isolated by companyId', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(customer);

    await expect(
      service.create({ name: customer.name, phone: customer.phone }, companyId),
    ).rejects.toThrow(ConflictException);
    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
      where: { phone: customer.phone, companyId },
    });
  });

  it.each(['1', '1234', '999999', '5512'])(
    'rejects invalid phone %s on create before querying Prisma',
    async (phone) => {
      await expect(
        service.create({ name: customer.name, phone }, companyId),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.customer.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.customer.create).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid phone on update without changing the Customer', async () => {
    await expect(
      service.update(customer.id, { phone: '5512' }, companyId),
    ).rejects.toThrow(BadRequestException);
    expect(prismaMock.customer.updateMany).not.toHaveBeenCalled();
  });

  const filteredWhere = async (filters: Partial<CustomerFilterDto>) => {
    await service.findFiltered(companyId, filters as CustomerFilterDto);
    return prismaMock.customer.findMany.mock.calls[0][0]
      .where as Prisma.CustomerWhereInput;
  };

  it.each([
    [{ gender: CustomerGender.FEMALE }, { gender: CustomerGender.FEMALE }],
    [
      { city: '  foz   do iguaçu ' },
      { city: { equals: 'foz do iguaçu', mode: Prisma.QueryMode.insensitive } },
    ],
    [{ state: 'pr' }, { state: 'PR' }],
    [
      { contactConsentStatus: CustomerContactConsentStatus.GRANTED },
      { contactConsentStatus: CustomerContactConsentStatus.GRANTED },
    ],
    [{ isActiveForAutomation: false }, { isActiveForAutomation: false }],
  ])(
    'adds filter %j without replacing tenant scope',
    async (filters, expected) => {
      await expect(filteredWhere(filters)).resolves.toEqual(
        expect.objectContaining({ companyId, ...expected }),
      );
    },
  );

  it('searches name case-insensitively and normalized phone within tenant', async () => {
    expect(await filteredWhere({ search: 'Maria' })).toEqual({
      companyId,
      OR: [
        {
          name: {
            contains: 'Maria',
            mode: Prisma.QueryMode.insensitive,
          },
        },
      ],
    });

    jest.clearAllMocks();
    prismaMock.customer.findMany.mockResolvedValue([]);
    prismaMock.customer.count.mockResolvedValue(0);
    expect(await filteredWhere({ search: '(45) 99999' })).toEqual({
      companyId,
      OR: [
        {
          name: {
            contains: '(45) 99999',
            mode: Prisma.QueryMode.insensitive,
          },
        },
        { phone: { contains: '4599999' } },
      ],
    });
  });

  it('combines age and last-purchase filters without losing companyId', async () => {
    const where = await filteredWhere({
      minAge: 18,
      maxAge: 35,
      lastPurchaseAfter: '2026-01-01T00:00:00.000Z',
      lastPurchaseBefore: '2026-08-01T00:00:00.000Z',
    });

    expect(where).toEqual(
      expect.objectContaining({
        companyId,
        birthDate: expect.objectContaining({
          gt: expect.any(Date),
          lte: expect.any(Date),
        }),
        lastPurchaseDate: {
          gt: new Date('2026-01-01T00:00:00.000Z'),
          lt: new Date('2026-08-01T00:00:00.000Z'),
        },
      }),
    );
  });

  it('uses date comparisons so null lastPurchaseDate does not match the filter', async () => {
    const where = await filteredWhere({
      lastPurchaseBefore: '2026-08-01T00:00:00.000Z',
    });

    expect(where.lastPurchaseDate).toEqual({
      lt: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('returns stable pagination metadata using findMany and count transaction', async () => {
    prismaMock.customer.count.mockResolvedValue(41);

    const result = await service.findFiltered(companyId, {
      page: 2,
      pageSize: 20,
    } as CustomerFilterDto);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId },
        skip: 20,
        take: 20,
      }),
    );
    expect(prismaMock.customer.count).toHaveBeenCalledWith({
      where: { companyId },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    });
  });
});
