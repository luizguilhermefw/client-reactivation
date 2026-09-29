import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomerInterestType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CustomerInterestNameValidationError,
  normalizeCustomerInterestName,
} from './customer-interest-normalization';
import {
  CUSTOMER_INTEREST_OPTION_PUBLIC_SELECT,
  CustomerInterestOptionPublicResponse,
} from './customer-interest-public-response';
import { CustomerInterestOptionFilterDto } from './dto/customer-interest-option-filter.dto';

@Injectable()
export class CustomerInterestOptionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    companyId: string,
    type: CustomerInterestType,
    rawName: string,
  ): Promise<CustomerInterestOptionPublicResponse> {
    const { name, normalizedName } = this.normalizeName(rawName);
    const duplicate = await this.prisma.customerInterestOption.findFirst({
      where: { companyId, type, normalizedName },
      select: { id: true },
    });

    if (duplicate) throw this.duplicateConflict(type);

    try {
      return await this.prisma.customerInterestOption.create({
        data: { companyId, type, name, normalizedName },
        select: CUSTOMER_INTEREST_OPTION_PUBLIC_SELECT,
      });
    } catch (error) {
      if (this.isLogicalDuplicateError(error)) {
        throw this.duplicateConflict(type);
      }
      throw error;
    }
  }

  list(
    companyId: string,
    filters: CustomerInterestOptionFilterDto,
  ): Promise<CustomerInterestOptionPublicResponse[]> {
    return this.prisma.customerInterestOption.findMany({
      where: {
        companyId,
        ...(filters.type !== undefined && { type: filters.type }),
        ...(filters.active !== undefined && { active: filters.active }),
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: CUSTOMER_INTEREST_OPTION_PUBLIC_SELECT,
    });
  }

  async updateName(
    companyId: string,
    id: string,
    rawName: string,
  ): Promise<CustomerInterestOptionPublicResponse> {
    const existing = await this.prisma.customerInterestOption.findFirst({
      where: { id, companyId },
      select: { id: true, type: true },
    });
    if (!existing)
      throw new NotFoundException('Opção de interesse não encontrada');

    const { name, normalizedName } = this.normalizeName(rawName);
    const duplicate = await this.prisma.customerInterestOption.findFirst({
      where: {
        companyId,
        type: existing.type,
        normalizedName,
        NOT: { id },
      },
      select: { id: true },
    });
    if (duplicate) throw this.duplicateConflict(existing.type);

    try {
      const result = await this.prisma.customerInterestOption.updateMany({
        where: { id, companyId },
        data: { name, normalizedName },
      });
      if (result.count === 0) {
        throw new NotFoundException('Opção de interesse não encontrada');
      }
    } catch (error) {
      if (this.isLogicalDuplicateError(error)) {
        throw this.duplicateConflict(existing.type);
      }
      throw error;
    }

    return this.loadPublic(companyId, id);
  }

  async updateStatus(
    companyId: string,
    id: string,
    active: boolean,
  ): Promise<CustomerInterestOptionPublicResponse> {
    const result = await this.prisma.customerInterestOption.updateMany({
      where: { id, companyId },
      data: { active },
    });
    if (result.count === 0) {
      throw new NotFoundException('Opção de interesse não encontrada');
    }

    return this.loadPublic(companyId, id);
  }

  private async loadPublic(
    companyId: string,
    id: string,
  ): Promise<CustomerInterestOptionPublicResponse> {
    const option = await this.prisma.customerInterestOption.findFirst({
      where: { id, companyId },
      select: CUSTOMER_INTEREST_OPTION_PUBLIC_SELECT,
    });
    if (!option)
      throw new NotFoundException('Opção de interesse não encontrada');
    return option;
  }

  private normalizeName(rawName: string) {
    try {
      return normalizeCustomerInterestName(rawName);
    } catch (error) {
      if (error instanceof CustomerInterestNameValidationError) {
        throw new BadRequestException('Nome da opção de interesse é inválido.');
      }
      throw error;
    }
  }

  private duplicateConflict(type: CustomerInterestType): ConflictException {
    return new ConflictException(
      type === CustomerInterestType.BRAND
        ? 'Já existe uma marca com esse nome.'
        : 'Já existe uma categoria com esse nome.',
    );
  }

  private isLogicalDuplicateError(error: unknown): boolean {
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
      (fields.includes('companyId') &&
        fields.includes('type') &&
        fields.includes('normalizedName')) ||
      combined.includes(
        'CustomerInterestOption_companyId_type_normalizedName_key',
      )
    );
  }
}
