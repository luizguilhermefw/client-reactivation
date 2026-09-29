import { NotFoundException } from '@nestjs/common';
import { CompanyStatus, CustomerInterestType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicCustomerRegistrationService } from './public-customer-registration.service';

describe('PublicCustomerRegistrationService', () => {
  const publicId = 'opaque-public-id';
  const company = {
    id: 'resolved-company',
    displayName: 'Outlet Cascavel',
    status: CompanyStatus.ACTIVE,
  };
  const category = {
    id: 'category-1',
    type: CustomerInterestType.CATEGORY,
    name: 'Smartphones',
  };
  const brand = {
    id: 'brand-1',
    type: CustomerInterestType.BRAND,
    name: 'Apple',
  };
  const prismaMock = {
    customerRegistrationLink: { findUnique: jest.fn() },
    customerInterestOption: { findMany: jest.fn() },
  };
  let service: PublicCustomerRegistrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PublicCustomerRegistrationService(
      prismaMock as unknown as PrismaService,
    );
    prismaMock.customerRegistrationLink.findUnique.mockResolvedValue({
      active: true,
      company,
    });
    prismaMock.customerInterestOption.findMany.mockResolvedValue([
      brand,
      category,
    ]);
  });

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

  it('does not return inactive or cross-tenant interests because the query is scoped', async () => {
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
  ])('returns the same generic 404 for %s', async (_scenario, record) => {
    prismaMock.customerRegistrationLink.findUnique.mockResolvedValue(record);

    const operation = service.getBootstrap(publicId);
    await expect(operation).rejects.toBeInstanceOf(NotFoundException);
    await expect(operation).rejects.toThrow('Cadastro indisponível');
    expect(prismaMock.customerInterestOption.findMany).not.toHaveBeenCalled();
  });
});
