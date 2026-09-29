import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CustomerInterestType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerInterestOptionService } from './customer-interest-option.service';
import { CUSTOMER_INTEREST_OPTION_PUBLIC_SELECT } from './customer-interest-public-response';

describe('CustomerInterestOptionService', () => {
  const companyId = 'company-1';
  const option = {
    id: 'option-1',
    type: CustomerInterestType.BRAND,
    name: 'Apple',
    active: true,
    createdAt: new Date('2026-09-28T00:00:00.000Z'),
    updatedAt: new Date('2026-09-28T00:00:00.000Z'),
  };
  const prismaMock = {
    customerInterestOption: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  let service: CustomerInterestOptionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomerInterestOptionService(
      prismaMock as unknown as PrismaService,
    );
    prismaMock.customerInterestOption.findFirst.mockResolvedValue(null);
    prismaMock.customerInterestOption.findMany.mockResolvedValue([option]);
    prismaMock.customerInterestOption.create.mockResolvedValue(option);
    prismaMock.customerInterestOption.updateMany.mockResolvedValue({
      count: 1,
    });
  });

  it.each([CustomerInterestType.CATEGORY, CustomerInterestType.BRAND])(
    'creates normalized %s inside the authenticated tenant',
    async (type) => {
      await expect(
        service.create(companyId, type, '  New   Balance  '),
      ).resolves.toEqual(option);

      expect(prismaMock.customerInterestOption.findFirst).toHaveBeenCalledWith({
        where: { companyId, type, normalizedName: 'new balance' },
        select: { id: true },
      });
      expect(prismaMock.customerInterestOption.create).toHaveBeenCalledWith({
        data: {
          companyId,
          type,
          name: 'New Balance',
          normalizedName: 'new balance',
        },
        select: CUSTOMER_INTEREST_OPTION_PUBLIC_SELECT,
      });
    },
  );

  it('rejects an empty normalized name', async () => {
    await expect(
      service.create(companyId, CustomerInterestType.BRAND, '   '),
    ).rejects.toThrow(BadRequestException);
    expect(prismaMock.customerInterestOption.findFirst).not.toHaveBeenCalled();
  });

  it('treats Apple and apple as a duplicate only for tenant and type', async () => {
    prismaMock.customerInterestOption.findFirst.mockResolvedValueOnce({
      id: option.id,
    });

    await expect(
      service.create(companyId, CustomerInterestType.BRAND, ' apple '),
    ).rejects.toThrow('Já existe uma marca com esse nome.');
    expect(prismaMock.customerInterestOption.findFirst).toHaveBeenCalledWith({
      where: {
        companyId,
        type: CustomerInterestType.BRAND,
        normalizedName: 'apple',
      },
      select: { id: true },
    });
  });

  it('allows the same normalized name in another tenant or type', async () => {
    await service.create('company-2', CustomerInterestType.BRAND, 'Apple');
    await service.create(companyId, CustomerInterestType.CATEGORY, 'Apple');

    expect(prismaMock.customerInterestOption.create).toHaveBeenNthCalledWith(
      1,
      {
        data: {
          companyId: 'company-2',
          type: CustomerInterestType.BRAND,
          name: 'Apple',
          normalizedName: 'apple',
        },
        select: CUSTOMER_INTEREST_OPTION_PUBLIC_SELECT,
      },
    );
    expect(prismaMock.customerInterestOption.create).toHaveBeenNthCalledWith(
      2,
      {
        data: {
          companyId,
          type: CustomerInterestType.CATEGORY,
          name: 'Apple',
          normalizedName: 'apple',
        },
        select: CUSTOMER_INTEREST_OPTION_PUBLIC_SELECT,
      },
    );
  });

  it('converts only the logical catalog P2002 into a safe conflict', async () => {
    prismaMock.customerInterestOption.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('sensitive database detail', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['companyId', 'type', 'normalizedName'] },
      }),
    );

    await expect(
      service.create(companyId, CustomerInterestType.BRAND, 'Apple'),
    ).rejects.toBeInstanceOf(ConflictException);

    const unrelated = new Prisma.PrismaClientKnownRequestError(
      'unrelated constraint',
      {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['id'] },
      },
    );
    prismaMock.customerInterestOption.create.mockRejectedValueOnce(unrelated);
    await expect(
      service.create(companyId, CustomerInterestType.BRAND, 'Apple'),
    ).rejects.toBe(unrelated);
  });

  it('lists only the tenant with optional filters and deterministic order', async () => {
    await service.list(companyId, {
      type: CustomerInterestType.BRAND,
      active: false,
    });

    expect(prismaMock.customerInterestOption.findMany).toHaveBeenCalledWith({
      where: { companyId, type: CustomerInterestType.BRAND, active: false },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: CUSTOMER_INTEREST_OPTION_PUBLIC_SELECT,
    });
  });

  it('does not update a name belonging to another tenant', async () => {
    await expect(
      service.updateName(companyId, 'other-tenant-option', 'Apple'),
    ).rejects.toThrow(NotFoundException);
    expect(prismaMock.customerInterestOption.findFirst).toHaveBeenCalledWith({
      where: { id: 'other-tenant-option', companyId },
      select: { id: true, type: true },
    });
    expect(prismaMock.customerInterestOption.updateMany).not.toHaveBeenCalled();
  });

  it('updates the normalized name without allowing type changes', async () => {
    prismaMock.customerInterestOption.findFirst
      .mockResolvedValueOnce({ id: option.id, type: option.type })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...option, name: 'New Balance' });

    await service.updateName(companyId, option.id, '  New   Balance  ');

    expect(prismaMock.customerInterestOption.updateMany).toHaveBeenCalledWith({
      where: { id: option.id, companyId },
      data: { name: 'New Balance', normalizedName: 'new balance' },
    });
  });

  it('rejects a normalized name collision during update', async () => {
    prismaMock.customerInterestOption.findFirst
      .mockResolvedValueOnce({ id: option.id, type: option.type })
      .mockResolvedValueOnce({ id: 'option-2' });

    await expect(
      service.updateName(companyId, option.id, ' apple '),
    ).rejects.toThrow('Já existe uma marca com esse nome.');
    expect(prismaMock.customerInterestOption.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [CustomerInterestType.BRAND, 'Já existe uma marca com esse nome.'],
    [CustomerInterestType.CATEGORY, 'Já existe uma categoria com esse nome.'],
  ])(
    'converts updateName P2002 race for %s into the expected conflict',
    async (type, expectedMessage) => {
      prismaMock.customerInterestOption.findFirst
        .mockResolvedValueOnce({ id: option.id, type })
        .mockResolvedValueOnce(null);
      prismaMock.customerInterestOption.updateMany.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('sensitive database detail', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['companyId', 'type', 'normalizedName'] },
        }),
      );

      const operation = service.updateName(
        companyId,
        option.id,
        ' New Balance ',
      );
      await expect(operation).rejects.toBeInstanceOf(ConflictException);
      await expect(operation).rejects.toThrow(expectedMessage);
    },
  );

  it('propagates an unrelated updateName P2002 without conversion', async () => {
    prismaMock.customerInterestOption.findFirst
      .mockResolvedValueOnce({ id: option.id, type: option.type })
      .mockResolvedValueOnce(null);
    const unrelated = new Prisma.PrismaClientKnownRequestError(
      'unrelated constraint',
      {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['id'] },
      },
    );
    prismaMock.customerInterestOption.updateMany.mockRejectedValueOnce(
      unrelated,
    );

    await expect(
      service.updateName(companyId, option.id, 'New Balance'),
    ).rejects.toBe(unrelated);
  });

  it.each([false, true])(
    'updates active status to %s tenant-safely',
    async (active) => {
      prismaMock.customerInterestOption.findFirst.mockResolvedValueOnce({
        ...option,
        active,
      });

      await service.updateStatus(companyId, option.id, active);

      expect(prismaMock.customerInterestOption.updateMany).toHaveBeenCalledWith(
        {
          where: { id: option.id, companyId },
          data: { active },
        },
      );
    },
  );

  it('does not update status of another tenant option', async () => {
    prismaMock.customerInterestOption.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    await expect(
      service.updateStatus(companyId, 'other-tenant-option', false),
    ).rejects.toThrow(NotFoundException);
  });
});
