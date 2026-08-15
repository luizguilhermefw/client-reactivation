import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, type Customer } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildBirthDateRange } from './customer-filter.helpers';
import {
  getCustomerPhoneIdentityVariants,
  isValidCustomerPhone,
  normalizeCustomerCity,
  normalizeCustomerPhone,
} from './customer-normalization';
import {
  isBrazilianStateCode,
  normalizeBrazilianState,
} from './customer-state';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerFilterDto } from './dto/customer-filter.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

export interface CustomerSearchResult {
  items: Customer[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizePhone(phone: string): string {
    const normalized = normalizeCustomerPhone(phone);
    if (!isValidCustomerPhone(normalized)) {
      throw new BadRequestException('Phone must be a valid Brazilian number');
    }
    return normalized;
  }

  private customerTenantWhere(id: string, companyId: string) {
    return { id, companyId };
  }

  private normalizeCity(value: string | null | undefined) {
    return normalizeCustomerCity(value);
  }

  private normalizeState(value: string | null | undefined) {
    const normalized = normalizeBrazilianState(value);
    if (normalized && !isBrazilianStateCode(normalized)) {
      throw new BadRequestException('State must be a valid Brazilian UF');
    }

    return normalized;
  }

  async create(createCustomerDto: CreateCustomerDto, companyId: string) {
    const { name, phone, birthDate, lastPurchaseDate, gender, city, state } =
      createCustomerDto;
    const normalizedPhone = this.normalizePhone(phone);
    const normalizedCity = this.normalizeCity(city);
    const normalizedState = this.normalizeState(state);

    // Verifica se já existe um cliente com esse telefone na empresa
    const customerExists = await this.prisma.customer.findFirst({
      where: {
        companyId,
        phone: { in: getCustomerPhoneIdentityVariants(normalizedPhone) },
      },
    });

    if (customerExists) {
      throw new ConflictException('Já existe um cliente com esse telefone.');
    }

    const customer = await this.prisma.customer.create({
      data: {
        name,
        phone: normalizedPhone,
        companyId,

        ...(gender !== undefined && { gender }),
        ...(normalizedCity !== undefined && { city: normalizedCity }),
        ...(normalizedState !== undefined && { state: normalizedState }),

        birthDate: birthDate ? new Date(birthDate) : null,

        lastPurchaseDate: lastPurchaseDate ? new Date(lastPurchaseDate) : null,
      },
    });

    return customer;
  }

  async findAll(companyId: string) {
    return this.prisma.customer.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findFiltered(
    companyId: string,
    filters: CustomerFilterDto,
    referenceDate = new Date(),
  ): Promise<CustomerSearchResult> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const where: Prisma.CustomerWhereInput = { companyId };
    const search = filters.search?.trim();

    if (search) {
      const phoneSearch = search.replace(/\D/g, '');
      where.OR = [
        { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ...(phoneSearch ? [{ phone: { contains: phoneSearch } }] : []),
      ];
    }

    if (filters.gender !== undefined) where.gender = filters.gender;

    const city = this.normalizeCity(filters.city);
    if (city) {
      where.city = { equals: city, mode: Prisma.QueryMode.insensitive };
    }

    const state = this.normalizeState(filters.state);
    if (state) where.state = state;

    const birthDate = buildBirthDateRange(
      filters.minAge,
      filters.maxAge,
      referenceDate,
    );
    if (birthDate) where.birthDate = birthDate;

    if (
      filters.lastPurchaseBefore !== undefined ||
      filters.lastPurchaseAfter !== undefined
    ) {
      where.lastPurchaseDate = {
        ...(filters.lastPurchaseBefore === undefined
          ? {}
          : { lt: new Date(filters.lastPurchaseBefore) }),
        ...(filters.lastPurchaseAfter === undefined
          ? {}
          : { gt: new Date(filters.lastPurchaseAfter) }),
      };
    }

    if (filters.contactConsentStatus !== undefined) {
      where.contactConsentStatus = filters.contactConsentStatus;
    }
    if (filters.isActiveForAutomation !== undefined) {
      where.isActiveForAutomation = filters.isActiveForAutomation;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async update(id: string, data: UpdateCustomerDto, companyId: string) {
    const { name, phone, birthDate, lastPurchaseDate, gender, city, state } =
      data;

    const normalizedPhone =
      phone !== undefined ? this.normalizePhone(phone) : undefined;
    const normalizedCity = this.normalizeCity(city);
    const normalizedState = this.normalizeState(state);

    // Verifica se já existe outro cliente com esse telefone
    if (normalizedPhone) {
      const customerWithPhone = await this.prisma.customer.findFirst({
        where: {
          companyId,
          phone: { in: getCustomerPhoneIdentityVariants(normalizedPhone) },
          NOT: {
            id,
          },
        },
      });

      if (customerWithPhone) {
        throw new ConflictException('Já existe um cliente com esse telefone.');
      }
    }

    const result = await this.prisma.customer.updateMany({
      where: this.customerTenantWhere(id, companyId),
      data: {
        ...(name !== undefined && { name }),

        ...(normalizedPhone !== undefined && {
          phone: normalizedPhone,
        }),

        ...(birthDate !== undefined && {
          birthDate: birthDate ? new Date(birthDate) : null,
        }),

        ...(lastPurchaseDate !== undefined && {
          lastPurchaseDate: lastPurchaseDate
            ? new Date(lastPurchaseDate)
            : null,
        }),

        ...(gender !== undefined && { gender }),
        ...(normalizedCity !== undefined && { city: normalizedCity }),
        ...(normalizedState !== undefined && { state: normalizedState }),
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return this.prisma.customer.findFirst({
      where: this.customerTenantWhere(id, companyId),
    });
  }

  async remove(id: string, companyId: string) {
    const result = await this.prisma.customer.deleteMany({
      where: this.customerTenantWhere(id, companyId),
    });

    if (result.count === 0) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return { message: 'Cliente removido com sucesso' };
  }

  async toggleAutomation(id: string, companyId: string) {
    const [customer] = await this.prisma.$queryRaw<Customer[]>`
      UPDATE "Customer"
      SET "isActiveForAutomation" = NOT "isActiveForAutomation"
      WHERE "id" = ${id}
        AND "companyId" = ${companyId}
      RETURNING
        "id",
        "name",
        "phone",
        "lastPurchaseDate",
        "birthDate",
        "isActiveForAutomation",
        "companyId",
        "createdAt"
    `;

    if (!customer) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return customer;
  }
}
