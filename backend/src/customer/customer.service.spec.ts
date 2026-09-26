import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomerContactConsentStatus,
  CustomerGender,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerService } from './customer.service';
import { CustomerFilterDto } from './dto/customer-filter.dto';
import { CustomerCpfCrypto } from './cpf/customer-cpf-crypto';

describe('CustomerService', () => {
  const companyId = 'company-1';
  const customer = {
    id: 'customer-1',
    companyId,
    name: 'Maria Ávila',
    preferredName: null,
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
  const customerWithFutureSensitiveField = {
    ...customer,
    cpfEncrypted: 'ciphertext',
    cpfEncryptionIv: 'iv',
    cpfEncryptionAuthTag: 'auth-tag',
    cpfEncryptionKeyVersion: 'v1',
    cpfLookupHash: 'lookup-hash',
    cpfLookupKeyVersion: 'v1',
    futureSensitiveField: 'must-not-leak',
  };
  const publicCustomerSelect = {
    id: true,
    name: true,
    preferredName: true,
    phone: true,
    gender: true,
    city: true,
    state: true,
    lastPurchaseDate: true,
    birthDate: true,
    isActiveForAutomation: true,
    contactConsentStatus: true,
    consentGrantedAt: true,
    optedOutAt: true,
    companyId: true,
    createdAt: true,
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
  const cpfCryptoMock = {
    createLookupHash: jest.fn().mockReturnValue({
      keyVersion: 'v1',
      hash: 'a'.repeat(64),
    }),
    encrypt: jest.fn().mockReturnValue({
      keyVersion: 'v1',
      iv: 'safe-iv',
      ciphertext: 'safe-ciphertext',
      authTag: 'safe-auth-tag',
    }),
  };
  let service: CustomerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomerService(
      prismaMock as unknown as PrismaService,
      cpfCryptoMock as unknown as CustomerCpfCrypto,
    );
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
      select: publicCustomerSelect,
    });
  });

  it.each([
    ['  Maria  ', 'Maria'],
    ['   ', null],
    [null, null],
  ])(
    'normalizes preferredName %j on create',
    async (preferredName, expected) => {
      await service.create(
        { name: customer.name, phone: customer.phone, preferredName },
        companyId,
      );

      expect(prismaMock.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ preferredName: expected }),
        }),
      );
    },
  );

  it('creates a legacy Customer without CPF without requiring crypto keys', async () => {
    await service.create(
      { name: customer.name, phone: customer.phone },
      companyId,
    );

    expect(cpfCryptoMock.createLookupHash).not.toHaveBeenCalled();
    expect(cpfCryptoMock.encrypt).not.toHaveBeenCalled();
    expect(prismaMock.customer.create.mock.calls[0][0].data).not.toEqual(
      expect.objectContaining({ cpfLookupHash: expect.anything() }),
    );
  });

  it('normalizes, hashes and encrypts CPF without sending plaintext to Prisma', async () => {
    const rawCpf = '529.982.247-25';

    await service.create(
      { name: customer.name, phone: customer.phone, cpf: rawCpf },
      companyId,
    );

    expect(cpfCryptoMock.createLookupHash).toHaveBeenCalledWith(
      companyId,
      '52998224725',
    );
    expect(cpfCryptoMock.encrypt).toHaveBeenCalledWith(
      companyId,
      '52998224725',
    );
    expect(prismaMock.customer.findFirst).toHaveBeenNthCalledWith(2, {
      where: { companyId, cpfLookupHash: 'a'.repeat(64) },
      select: { id: true },
    });

    const persisted = prismaMock.customer.create.mock.calls[0][0].data;
    expect(persisted).toEqual(
      expect.objectContaining({
        cpfEncrypted: 'safe-ciphertext',
        cpfEncryptionIv: 'safe-iv',
        cpfEncryptionAuthTag: 'safe-auth-tag',
        cpfEncryptionKeyVersion: 'v1',
        cpfLookupHash: 'a'.repeat(64),
        cpfLookupKeyVersion: 'v1',
      }),
    );
    expect(JSON.stringify(persisted)).not.toContain(rawCpf);
    expect(JSON.stringify(persisted)).not.toContain('52998224725');
  });

  it('rejects duplicate CPF only inside the same company', async () => {
    prismaMock.customer.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'customer-2' });

    await expect(
      service.create(
        { name: customer.name, phone: customer.phone, cpf: '52998224725' },
        companyId,
      ),
    ).rejects.toThrow(ConflictException);

    expect(prismaMock.customer.create).not.toHaveBeenCalled();
    expect(prismaMock.customer.findFirst).toHaveBeenNthCalledWith(2, {
      where: { companyId, cpfLookupHash: 'a'.repeat(64) },
      select: { id: true },
    });
  });

  it('allows the same CPF in another company', async () => {
    await service.create(
      { name: customer.name, phone: customer.phone, cpf: '52998224725' },
      'company-2',
    );

    expect(prismaMock.customer.findFirst).toHaveBeenNthCalledWith(2, {
      where: { companyId: 'company-2', cpfLookupHash: 'a'.repeat(64) },
      select: { id: true },
    });
    expect(prismaMock.customer.create).toHaveBeenCalled();
  });

  it('rejects invalid CPF safely before persistence', async () => {
    await expect(
      service.create(
        { name: customer.name, phone: customer.phone, cpf: '111.111.111-11' },
        companyId,
      ),
    ).rejects.toMatchObject({
      response: expect.not.stringContaining('111.111.111-11'),
    });

    expect(prismaMock.customer.create).not.toHaveBeenCalled();
  });

  it('returns only the explicit public projection after create', async () => {
    prismaMock.customer.create.mockResolvedValue(
      customerWithFutureSensitiveField,
    );

    const result = await service.create(
      { name: customer.name, phone: customer.phone },
      companyId,
    );

    expect(result).toEqual(customer);
    expect(result).not.toHaveProperty('futureSensitiveField');
    expect(result).not.toHaveProperty('cpfEncrypted');
    expect(result).not.toHaveProperty('cpfLookupHash');
  });

  it('uses the explicit public projection in findAll', async () => {
    prismaMock.customer.findMany.mockResolvedValue([
      customerWithFutureSensitiveField,
    ]);

    const result = await service.findAll(companyId);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: publicCustomerSelect,
    });
    expect(result).toEqual([customer]);
    expect(result[0]).not.toHaveProperty('futureSensitiveField');
  });

  it('uses the explicit public projection in filtered results', async () => {
    prismaMock.customer.findMany.mockResolvedValue([
      customerWithFutureSensitiveField,
    ]);

    const result = await service.findFiltered(companyId, {
      page: 1,
      pageSize: 20,
    } as CustomerFilterDto);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId },
        select: publicCustomerSelect,
      }),
    );
    expect(result.items).toEqual([customer]);
    expect(result.items[0]).not.toHaveProperty('futureSensitiveField');
  });

  it('returns the explicit public projection after tenant-scoped update', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(
      customerWithFutureSensitiveField,
    );

    const result = await service.update(
      customer.id,
      { name: 'Updated' },
      companyId,
    );

    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
      where: { id: customer.id, companyId },
      data: { name: 'Updated' },
    });
    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
      where: { id: customer.id, companyId },
      select: publicCustomerSelect,
    });
    expect(result).toEqual(customer);
    expect(result).not.toHaveProperty('futureSensitiveField');
    expect(result).not.toHaveProperty('cpfEncryptionAuthTag');
    expect(result).not.toHaveProperty('cpfLookupKeyVersion');
  });

  it('keeps CPF unchanged when update omits cpf', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(customer);

    await service.update(customer.id, { name: 'Updated' }, companyId);

    expect(cpfCryptoMock.createLookupHash).not.toHaveBeenCalled();
    expect(cpfCryptoMock.encrypt).not.toHaveBeenCalled();
    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
      where: { id: customer.id, companyId },
      data: { name: 'Updated' },
    });
  });

  it('preserves preferredName when update omits it', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(customer);

    await service.update(customer.id, { name: 'Updated' }, companyId);

    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
      where: { id: customer.id, companyId },
      data: { name: 'Updated' },
    });
  });

  it.each([
    [null, null],
    ['  Maria  ', 'Maria'],
    ['   ', null],
  ])(
    'normalizes preferredName %j on update',
    async (preferredName, expected) => {
      prismaMock.customer.findFirst.mockResolvedValue(customer);

      await service.update(customer.id, { preferredName }, companyId);

      expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
        where: { id: customer.id, companyId },
        data: { preferredName: expected },
      });
    },
  );

  it('clears every CPF field when cpf is null', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(customer);

    await service.update(customer.id, { cpf: null }, companyId);

    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
      where: { id: customer.id, companyId },
      data: {
        cpfEncrypted: null,
        cpfEncryptionIv: null,
        cpfEncryptionAuthTag: null,
        cpfEncryptionKeyVersion: null,
        cpfLookupHash: null,
        cpfLookupKeyVersion: null,
      },
    });
  });

  it('updates CPF with fresh tenant-scoped cryptographic material', async () => {
    prismaMock.customer.findFirst
      .mockResolvedValueOnce({ id: customer.id })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(customer);

    await service.update(customer.id, { cpf: '529.982.247-25' }, companyId);

    expect(prismaMock.customer.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: customer.id, companyId },
      select: { id: true },
    });
    expect(prismaMock.customer.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        companyId,
        cpfLookupHash: 'a'.repeat(64),
        NOT: { id: customer.id },
      },
      select: { id: true },
    });
    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
      where: { id: customer.id, companyId },
      data: expect.objectContaining({
        cpfEncrypted: 'safe-ciphertext',
        cpfLookupHash: 'a'.repeat(64),
      }),
    });
  });

  it('checks update CPF duplicates only inside the current tenant', async () => {
    prismaMock.customer.findFirst
      .mockResolvedValueOnce({ id: customer.id })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(customer);

    await service.update(customer.id, { cpf: '52998224725' }, 'company-2');

    expect(prismaMock.customer.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: customer.id, companyId: 'company-2' },
      select: { id: true },
    });
    expect(prismaMock.customer.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        companyId: 'company-2',
        cpfLookupHash: 'a'.repeat(64),
        NOT: { id: customer.id },
      },
      select: { id: true },
    });
    expect(prismaMock.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: customer.id, companyId: 'company-2' },
      }),
    );
  });

  it('rejects invalid CPF on update without touching Prisma', async () => {
    await expect(
      service.update(customer.id, { cpf: '' }, companyId),
    ).rejects.toThrow(BadRequestException);

    expect(prismaMock.customer.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.customer.updateMany).not.toHaveBeenCalled();
  });

  it('returns tenant-scoped NotFound before checking CPF duplication', async () => {
    const rawCpf = '529.982.247-25';
    prismaMock.customer.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'customer-with-that-cpf' });

    try {
      await service.update('missing-customer', { cpf: rawCpf }, companyId);
      throw new Error('Expected Customer not found');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).not.toBeInstanceOf(ConflictException);
      expect(String(error)).not.toContain(rawCpf);
      expect(String(error)).not.toContain('a'.repeat(64));
    }

    expect(prismaMock.customer.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 'missing-customer', companyId },
      select: { id: true },
    });
    expect(cpfCryptoMock.createLookupHash).not.toHaveBeenCalled();
    expect(cpfCryptoMock.encrypt).not.toHaveBeenCalled();
    expect(prismaMock.customer.updateMany).not.toHaveBeenCalled();
  });

  it('rejects another Customer CPF in the tenant but permits the own CPF', async () => {
    prismaMock.customer.findFirst
      .mockResolvedValueOnce({ id: customer.id })
      .mockResolvedValueOnce({ id: 'customer-2' });

    await expect(
      service.update(customer.id, { cpf: '52998224725' }, companyId),
    ).rejects.toThrow(ConflictException);
    expect(prismaMock.customer.updateMany).not.toHaveBeenCalled();

    jest.clearAllMocks();
    prismaMock.customer.findFirst
      .mockResolvedValueOnce({ id: customer.id })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(customer);
    prismaMock.customer.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.update(customer.id, { cpf: '52998224725' }, companyId),
    ).resolves.toEqual(customer);
  });

  it('converts only the CPF unique P2002 into a safe conflict', async () => {
    const cpfRace = new Prisma.PrismaClientKnownRequestError(
      'database detail with hash ' + 'a'.repeat(64),
      {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['companyId', 'cpfLookupHash'] },
      },
    );
    prismaMock.customer.create.mockRejectedValueOnce(cpfRace);

    await expect(
      service.create(
        { name: customer.name, phone: customer.phone, cpf: '52998224725' },
        companyId,
      ),
    ).rejects.toMatchObject({
      message: 'Já existe um cliente com esse CPF.',
    });

    const unrelated = new Prisma.PrismaClientKnownRequestError(
      'unrelated database constraint',
      {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['companyId', 'phone'] },
      },
    );
    prismaMock.customer.create.mockRejectedValueOnce(unrelated);

    await expect(
      service.create(
        { name: customer.name, phone: customer.phone, cpf: '52998224725' },
        companyId,
      ),
    ).rejects.toBe(unrelated);
  });

  it('converts CPF P2002 on update without exposing CPF or hash', async () => {
    prismaMock.customer.findFirst
      .mockResolvedValueOnce({ id: customer.id })
      .mockResolvedValueOnce(null);
    prismaMock.customer.updateMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('sensitive detail', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: 'Customer_companyId_cpfLookupHash_key' },
      }),
    );

    try {
      await service.update(customer.id, { cpf: '529.982.247-25' }, companyId);
      throw new Error('Expected CPF conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect(String(error)).not.toContain('529.982.247-25');
      expect(String(error)).not.toContain('a'.repeat(64));
    }
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
      select: publicCustomerSelect,
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
      where: {
        companyId,
        phone: { in: ['5545999999999', '554599999999'] },
      },
      select: { id: true },
    });
  });

  it('blocks an equivalent legacy mobile variant inside the same company', async () => {
    prismaMock.customer.findFirst.mockResolvedValue({
      ...customer,
      phone: '554599029181',
    });

    await expect(
      service.create(
        { name: customer.name, phone: '(45) 9 9902-9181' },
        companyId,
      ),
    ).rejects.toThrow(ConflictException);

    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
      where: {
        companyId,
        phone: { in: ['5545999029181', '554599029181'] },
      },
      select: { id: true },
    });
    expect(prismaMock.customer.create).not.toHaveBeenCalled();
  });

  it('allows the equivalent phone identity in another company', async () => {
    const otherCompanyId = 'company-2';
    prismaMock.customer.findFirst.mockResolvedValue(null);

    await service.create(
      { name: customer.name, phone: '+55 45 9902-9181' },
      otherCompanyId,
    );

    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: otherCompanyId,
        phone: { in: ['5545999029181', '554599029181'] },
      },
      select: { id: true },
    });
    expect(prismaMock.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: otherCompanyId,
        phone: '5545999029181',
      }),
      select: publicCustomerSelect,
    });
  });

  it('blocks update to an equivalent phone owned by another Customer in the tenant', async () => {
    prismaMock.customer.findFirst.mockResolvedValueOnce({
      ...customer,
      id: 'customer-2',
      phone: '554599029181',
    });

    await expect(
      service.update(customer.id, { phone: '5545999029181' }, companyId),
    ).rejects.toThrow(ConflictException);

    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
      where: {
        companyId,
        phone: { in: ['5545999029181', '554599029181'] },
        NOT: { id: customer.id },
      },
      select: { id: true },
    });
    expect(prismaMock.customer.updateMany).not.toHaveBeenCalled();
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
