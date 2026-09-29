import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  CustomerContactConsentStatus,
  Prisma,
  type Customer,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildBirthDateRange } from './customer-filter.helpers';
import {
  CUSTOMER_PUBLIC_SELECT,
  CustomerPublicResponse,
  toCustomerPublicResponse,
} from './customer-public-response';
import {
  getCustomerPhoneIdentityVariants,
  isValidCustomerPhone,
  normalizeCustomerCity,
  normalizeCustomerPhone,
  normalizeCustomerPreferredName,
} from './customer-normalization';
import {
  isBrazilianStateCode,
  normalizeBrazilianState,
} from './customer-state';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerFilterDto } from './dto/customer-filter.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerCpfCrypto } from './cpf/customer-cpf-crypto';
import {
  assertValidCpf,
  CustomerCpfValidationError,
} from './cpf/customer-cpf-normalization';

export interface CustomerSearchResult {
  items: CustomerPublicResponse[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

type CustomerCreateClient = Pick<Prisma.TransactionClient, 'customer'>;

export interface CustomerCreateSystemFields {
  contactConsentStatus: CustomerContactConsentStatus;
  consentGrantedAt: Date | null;
  optedOutAt: Date | null;
}

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cpfCrypto: CustomerCpfCrypto,
  ) {}

  private readonly cpfConflictMessage = 'Já existe um cliente com esse CPF.';

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

  private normalizeCpf(cpf: string): string {
    try {
      return assertValidCpf(cpf);
    } catch (error) {
      if (error instanceof CustomerCpfValidationError) {
        throw new BadRequestException('CPF inválido');
      }
      throw error;
    }
  }

  private prepareCpf(companyId: string, normalizedCpf: string) {
    const lookup = this.cpfCrypto.createLookupHash(companyId, normalizedCpf);
    const encrypted = this.cpfCrypto.encrypt(companyId, normalizedCpf);

    return {
      cpfEncrypted: encrypted.ciphertext,
      cpfEncryptionIv: encrypted.iv,
      cpfEncryptionAuthTag: encrypted.authTag,
      cpfEncryptionKeyVersion: encrypted.keyVersion,
      cpfLookupHash: lookup.hash,
      // Retained for a future lookup-key rotation/backfill strategy.
      cpfLookupKeyVersion: lookup.keyVersion,
    };
  }

  private isCpfUniqueConstraintError(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.map(String)
      : typeof target === 'string'
        ? [target]
        : [];
    const combined = fields.join(' ');

    return (
      (fields.includes('companyId') && fields.includes('cpfLookupHash')) ||
      combined.includes('Customer_companyId_cpfLookupHash_key')
    );
  }

  async create(createCustomerDto: CreateCustomerDto, companyId: string) {
    return this.createWithClient(createCustomerDto, companyId, this.prisma);
  }

  async createWithClient(
    createCustomerDto: CreateCustomerDto,
    companyId: string,
    client: CustomerCreateClient,
    systemFields?: CustomerCreateSystemFields,
  ) {
    const {
      name,
      preferredName,
      phone,
      cpf,
      birthDate,
      lastPurchaseDate,
      gender,
      city,
      state,
    } = createCustomerDto;
    const normalizedPhone = this.normalizePhone(phone);
    const normalizedPreferredName =
      normalizeCustomerPreferredName(preferredName);
    const normalizedCity = this.normalizeCity(city);
    const normalizedState = this.normalizeState(state);
    const cpfData =
      cpf === undefined
        ? undefined
        : this.prepareCpf(companyId, this.normalizeCpf(cpf));

    // Verifica se já existe um cliente com esse telefone na empresa
    const customerExists = await client.customer.findFirst({
      where: {
        companyId,
        phone: { in: getCustomerPhoneIdentityVariants(normalizedPhone) },
      },
      select: { id: true },
    });

    if (customerExists) {
      throw new ConflictException('Já existe um cliente com esse telefone.');
    }

    if (cpfData) {
      const customerWithCpf = await client.customer.findFirst({
        where: { companyId, cpfLookupHash: cpfData.cpfLookupHash },
        select: { id: true },
      });

      if (customerWithCpf) {
        throw new ConflictException(this.cpfConflictMessage);
      }
    }

    try {
      const customer = await client.customer.create({
        data: {
          name,
          ...(normalizedPreferredName !== undefined && {
            preferredName: normalizedPreferredName,
          }),
          phone: normalizedPhone,
          companyId,
          ...(cpfData ?? {}),

          ...(gender !== undefined && { gender }),
          ...(normalizedCity !== undefined && { city: normalizedCity }),
          ...(normalizedState !== undefined && { state: normalizedState }),

          birthDate: birthDate ? new Date(birthDate) : null,

          lastPurchaseDate: lastPurchaseDate
            ? new Date(lastPurchaseDate)
            : null,
          ...(systemFields ?? {}),
        },
        select: CUSTOMER_PUBLIC_SELECT,
      });

      return toCustomerPublicResponse(customer);
    } catch (error) {
      if (this.isCpfUniqueConstraintError(error)) {
        throw new ConflictException(this.cpfConflictMessage);
      }
      throw error;
    }
  }

  async findAll(companyId: string): Promise<CustomerPublicResponse[]> {
    const customers = await this.prisma.customer.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: CUSTOMER_PUBLIC_SELECT,
    });

    return customers.map(toCustomerPublicResponse);
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
        select: CUSTOMER_PUBLIC_SELECT,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      items: items.map(toCustomerPublicResponse),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async update(id: string, data: UpdateCustomerDto, companyId: string) {
    const {
      name,
      preferredName,
      phone,
      cpf,
      birthDate,
      lastPurchaseDate,
      gender,
      city,
      state,
    } = data;

    const normalizedPhone =
      phone !== undefined ? this.normalizePhone(phone) : undefined;
    const normalizedPreferredName =
      normalizeCustomerPreferredName(preferredName);
    const normalizedCity = this.normalizeCity(city);
    const normalizedState = this.normalizeState(state);
    let cpfData: ReturnType<CustomerService['prepareCpf']> | undefined;
    if (typeof cpf === 'string') {
      const normalizedCpf = this.normalizeCpf(cpf);
      const existingCustomer = await this.prisma.customer.findFirst({
        where: this.customerTenantWhere(id, companyId),
        select: { id: true },
      });

      if (!existingCustomer) {
        throw new NotFoundException('Cliente não encontrado');
      }

      cpfData = this.prepareCpf(companyId, normalizedCpf);
    }

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
        select: { id: true },
      });

      if (customerWithPhone) {
        throw new ConflictException('Já existe um cliente com esse telefone.');
      }
    }

    if (cpfData) {
      const customerWithCpf = await this.prisma.customer.findFirst({
        where: {
          companyId,
          cpfLookupHash: cpfData.cpfLookupHash,
          NOT: { id },
        },
        select: { id: true },
      });

      if (customerWithCpf) {
        throw new ConflictException(this.cpfConflictMessage);
      }
    }

    let result: { count: number };
    try {
      result = await this.prisma.customer.updateMany({
        where: this.customerTenantWhere(id, companyId),
        data: {
          ...(name !== undefined && { name }),
          ...(normalizedPreferredName !== undefined && {
            preferredName: normalizedPreferredName,
          }),

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
          ...(cpf === null
            ? {
                cpfEncrypted: null,
                cpfEncryptionIv: null,
                cpfEncryptionAuthTag: null,
                cpfEncryptionKeyVersion: null,
                cpfLookupHash: null,
                cpfLookupKeyVersion: null,
              }
            : (cpfData ?? {})),
        },
      });
    } catch (error) {
      if (this.isCpfUniqueConstraintError(error)) {
        throw new ConflictException(this.cpfConflictMessage);
      }
      throw error;
    }

    if (result.count === 0) {
      throw new NotFoundException('Cliente não encontrado');
    }

    const updatedCustomer = await this.prisma.customer.findFirst({
      where: this.customerTenantWhere(id, companyId),
      select: CUSTOMER_PUBLIC_SELECT,
    });

    return updatedCustomer
      ? toCustomerPublicResponse(updatedCustomer)
      : updatedCustomer;
  }

  async remove(id: string, companyId: string) {
    await this.prisma.$transaction(async (transaction) => {
      const customer = await transaction.customer.findFirst({
        where: this.customerTenantWhere(id, companyId),
        select: { id: true },
      });
      if (!customer) {
        throw new NotFoundException('Cliente não encontrado');
      }

      await transaction.customerInterest.deleteMany({
        where: { companyId, customerId: id },
      });
      const result = await transaction.customer.deleteMany({
        where: this.customerTenantWhere(id, companyId),
      });
      if (result.count === 0) {
        throw new NotFoundException('Cliente não encontrado');
      }
    });

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
