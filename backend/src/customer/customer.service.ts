import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizePhone(phone: string): string {
    let normalized = phone.replace(/\D/g, '');

    // Se vier apenas com DDD + número (11 dígitos), adiciona o código do Brasil
    if (normalized.length === 11) {
      normalized = `55${normalized}`;
    }

    return normalized;
  }

  private customerTenantWhere(id: string, companyId: string) {
    return { id, companyId };
  }

  async create(createCustomerDto: CreateCustomerDto, companyId: string) {
    const { name, phone, birthDate, lastPurchaseDate } = createCustomerDto;
    const normalizedPhone = this.normalizePhone(phone);

    // Verifica se já existe um cliente com esse telefone na empresa
    const customerExists = await this.prisma.customer.findFirst({
      where: {
        phone: normalizedPhone,
        companyId,
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

        birthDate: birthDate ? new Date(birthDate) : null,

        lastPurchaseDate: lastPurchaseDate
          ? new Date(lastPurchaseDate)
          : new Date(),
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

  async update(id: string, data: UpdateCustomerDto, companyId: string) {
    const { name, phone, birthDate, lastPurchaseDate } = data;

    const normalizedPhone =
      phone !== undefined ? this.normalizePhone(phone) : undefined;

    // Verifica se já existe outro cliente com esse telefone
    if (normalizedPhone) {
      const customerWithPhone = await this.prisma.customer.findFirst({
        where: {
          phone: normalizedPhone,
          companyId,
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
          lastPurchaseDate: new Date(lastPurchaseDate),
        }),
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
