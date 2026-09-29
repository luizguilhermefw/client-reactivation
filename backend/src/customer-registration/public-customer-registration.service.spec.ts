import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  CompanyStatus,
  CustomerContactConsentStatus,
  CustomerGender,
  CustomerInterestType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerService } from '../customer/customer.service';
import { PublicCustomerRegistrationDto } from './dto/public-customer-registration.dto';
import { PublicCustomerRegistrationService } from './public-customer-registration.service';

describe('PublicCustomerRegistrationService', () => {
  const publicId = 'A'.repeat(43);
  const consentAt = new Date('2026-09-29T12:00:00.000Z');
  const categoryId = '8156cf3a-4baa-4680-843f-f901297940f2';
  const brandId = '3f785c9c-f130-4dc0-8a9e-150ab54d821f';
  const company = {
    id: 'resolved-company',
    displayName: 'Outlet Cascavel',
    status: CompanyStatus.ACTIVE,
  };
  const category = {
    id: categoryId,
    type: CustomerInterestType.CATEGORY,
    name: 'Smartphones',
  };
  const brand = {
    id: brandId,
    type: CustomerInterestType.BRAND,
    name: 'Apple',
  };
  const dto: PublicCustomerRegistrationDto = {
    name: 'Maria da Silva',
    preferredName: 'Maria',
    phone: '45999999999',
    cpf: '52998224725',
    birthDate: '1990-05-10',
    gender: CustomerGender.FEMALE,
    city: 'Cascavel',
    state: 'PR',
    contactConsent: true,
    interestOptionIds: [categoryId, brandId],
  };
  const transactionMock = {
    customerRegistrationLink: { findUnique: jest.fn() },
    customerInterestOption: { findMany: jest.fn() },
    customerInterest: { createMany: jest.fn() },
  };
  const prismaMock = {
    customerRegistrationLink: { findUnique: jest.fn() },
    customerInterestOption: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const customerServiceMock = { createWithClient: jest.fn() };
  let service: PublicCustomerRegistrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(consentAt);
    service = new PublicCustomerRegistrationService(
      prismaMock as unknown as PrismaService,
      customerServiceMock as unknown as CustomerService,
    );
    const availableLink = { active: true, company };
    prismaMock.customerRegistrationLink.findUnique.mockResolvedValue(
      availableLink,
    );
    prismaMock.customerInterestOption.findMany.mockResolvedValue([
      brand,
      category,
    ]);
    transactionMock.customerRegistrationLink.findUnique.mockResolvedValue(
      availableLink,
    );
    transactionMock.customerInterestOption.findMany.mockResolvedValue([
      { id: categoryId },
      { id: brandId },
    ]);
    transactionMock.customerInterest.createMany.mockResolvedValue({ count: 2 });
    customerServiceMock.createWithClient.mockResolvedValue({
      id: 'customer-1',
    });
    prismaMock.$transaction.mockImplementation(
      (operation: (transaction: typeof transactionMock) => unknown) =>
        operation(transactionMock),
    );
  });

  afterAll(() => jest.useRealTimers());

  it('resolves the tenant internally and returns only public bootstrap data', async () => {
    const result = await service.getBootstrap(publicId);

    expect(prismaMock.customerRegistrationLink.findUnique).toHaveBeenCalledWith(
      {
        where: { publicId },
        select: {
          active: true,
          company: {
            select: { id: true, displayName: true, status: true },
          },
        },
      },
    );
    expect(prismaMock.customerInterestOption.findMany).toHaveBeenCalledWith({
      where: { companyId: company.id, active: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: { id: true, type: true, name: true },
    });
    expect(result).toEqual({
      company: { displayName: company.displayName },
      interests: { categories: [category], brands: [brand] },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /companyId|cnpj|normalizedName|status/i,
    );
  });

  it('rejects malformed publicId before any GET database query', async () => {
    await expect(service.getBootstrap('invalid')).rejects.toThrow(
      'Cadastro indisponível',
    );
    expect(
      prismaMock.customerRegistrationLink.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('does not return inactive or cross-tenant interests because GET is scoped', async () => {
    prismaMock.customerInterestOption.findMany.mockResolvedValue([]);

    await expect(service.getBootstrap(publicId)).resolves.toEqual({
      company: { displayName: company.displayName },
      interests: { categories: [], brands: [] },
    });
    expect(prismaMock.customerInterestOption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: company.id, active: true },
      }),
    );
  });

  it.each([
    ['missing link', null],
    ['missing Company', { active: true, company: null }],
    ['inactive link', { active: false, company }],
    [
      'PENDING Company',
      { active: true, company: { ...company, status: CompanyStatus.PENDING } },
    ],
    [
      'SUSPENDED Company',
      {
        active: true,
        company: { ...company, status: CompanyStatus.SUSPENDED },
      },
    ],
    [
      'CANCELLED Company',
      {
        active: true,
        company: { ...company, status: CompanyStatus.CANCELLED },
      },
    ],
  ])('returns the same generic GET 404 for %s', async (_scenario, record) => {
    prismaMock.customerRegistrationLink.findUnique.mockResolvedValue(record);

    const operation = service.getBootstrap(publicId);
    await expect(operation).rejects.toBeInstanceOf(NotFoundException);
    await expect(operation).rejects.toThrow('Cadastro indisponível');
    expect(prismaMock.customerInterestOption.findMany).not.toHaveBeenCalled();
  });

  it('creates Customer, consent and CATEGORY/BRAND associations in one serializable transaction', async () => {
    const result = await service.submit(publicId, dto);

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(
      transactionMock.customerInterestOption.findMany,
    ).toHaveBeenCalledWith({
      where: {
        companyId: company.id,
        active: true,
        id: { in: [categoryId, brandId] },
      },
      select: { id: true },
    });
    expect(customerServiceMock.createWithClient).toHaveBeenCalledWith(
      {
        name: dto.name,
        preferredName: dto.preferredName,
        phone: dto.phone,
        cpf: dto.cpf,
        birthDate: dto.birthDate,
        gender: dto.gender,
        city: dto.city,
        state: dto.state,
      },
      company.id,
      transactionMock,
      {
        contactConsentStatus: CustomerContactConsentStatus.GRANTED,
        consentGrantedAt: consentAt,
        optedOutAt: null,
      },
    );
    expect(transactionMock.customerInterest.createMany).toHaveBeenCalledWith({
      data: [
        {
          companyId: company.id,
          customerId: 'customer-1',
          interestOptionId: categoryId,
        },
        {
          companyId: company.id,
          customerId: 'customer-1',
          interestOptionId: brandId,
        },
      ],
    });
    expect(result).toEqual({
      success: true,
      message: 'Cadastro realizado com sucesso.',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /customerId|companyId|cpf|phone/i,
    );
  });

  it('persists explicit OPTED_OUT consent when contactConsent is false', async () => {
    transactionMock.customerInterestOption.findMany.mockResolvedValue([]);

    await service.submit(publicId, {
      ...dto,
      contactConsent: false,
      interestOptionIds: [],
    });

    expect(customerServiceMock.createWithClient).toHaveBeenCalledWith(
      expect.any(Object),
      company.id,
      transactionMock,
      {
        contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
        consentGrantedAt: null,
        optedOutAt: consentAt,
      },
    );
    expect(transactionMock.customerInterest.createMany).not.toHaveBeenCalled();
  });

  it('rejects inactive, missing or cross-tenant interests before Customer creation', async () => {
    transactionMock.customerInterestOption.findMany.mockResolvedValue([
      { id: categoryId },
    ]);

    await expect(service.submit(publicId, dto)).rejects.toThrow(
      new BadRequestException('Uma ou mais opções de interesse são inválidas.'),
    );
    expect(customerServiceMock.createWithClient).not.toHaveBeenCalled();
    expect(transactionMock.customerInterest.createMany).not.toHaveBeenCalled();
  });

  it('does not return success when CustomerInterest persistence fails', async () => {
    const databaseError = new Error('association failure');
    transactionMock.customerInterest.createMany.mockRejectedValue(
      databaseError,
    );

    await expect(service.submit(publicId, dto)).rejects.toBe(databaseError);
    expect(customerServiceMock.createWithClient).toHaveBeenCalledWith(
      expect.any(Object),
      company.id,
      transactionMock,
      expect.any(Object),
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not create interests or return success when Customer/consent persistence fails', async () => {
    const databaseError = new Error('customer persistence failure');
    customerServiceMock.createWithClient.mockRejectedValue(databaseError);

    await expect(service.submit(publicId, dto)).rejects.toBe(databaseError);
    expect(transactionMock.customerInterest.createMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('converts known Customer conflicts into one public message without retry', async () => {
    customerServiceMock.createWithClient.mockRejectedValue(
      new ConflictException('Já existe um cliente com esse CPF.'),
    );

    await expect(service.submit(publicId, dto)).rejects.toThrow(
      'Não foi possível concluir o cadastro com os dados informados.',
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed POST publicId before opening a transaction', async () => {
    await expect(service.submit('invalid', dto)).rejects.toThrow(
      'Cadastro indisponível',
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['missing link', null],
    ['inactive link', { active: false, company }],
    [
      'PENDING Company',
      { active: true, company: { ...company, status: CompanyStatus.PENDING } },
    ],
    [
      'SUSPENDED Company',
      {
        active: true,
        company: { ...company, status: CompanyStatus.SUSPENDED },
      },
    ],
    [
      'CANCELLED Company',
      {
        active: true,
        company: { ...company, status: CompanyStatus.CANCELLED },
      },
    ],
  ])('returns the same generic POST 404 for %s', async (_scenario, record) => {
    transactionMock.customerRegistrationLink.findUnique.mockResolvedValue(
      record,
    );

    await expect(service.submit(publicId, dto)).rejects.toThrow(
      'Cadastro indisponível',
    );
    expect(customerServiceMock.createWithClient).not.toHaveBeenCalled();
  });

  it('retries the complete transaction after P2034 and then succeeds', async () => {
    prismaMock.$transaction.mockRejectedValueOnce({ code: 'P2034' });

    await expect(service.submit(publicId, dto)).resolves.toEqual({
      success: true,
      message: 'Cadastro realizado com sucesso.',
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('limits P2034 retries to three attempts', async () => {
    const conflict = { code: 'P2034' };
    prismaMock.$transaction.mockRejectedValue(conflict);

    await expect(service.submit(publicId, dto)).rejects.toBe(conflict);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['unknown error', new Error('unknown')],
    ['validation error', new BadRequestException('invalid')],
    [
      'ordinary P2002',
      new Prisma.PrismaClientKnownRequestError('database conflict', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['unrelated'] },
      }),
    ],
  ])('does not retry %s', async (_scenario, error) => {
    prismaMock.$transaction.mockRejectedValue(error);

    await expect(service.submit(publicId, dto)).rejects.toBe(error);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
