import { Injectable, NotFoundException } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  private customerTenantWhere(id: string, companyId: string) {
    return { id, companyId };
  }

  async create(createCustomerDto: CreateCustomerDto, companyId: string) {
    const { name, phone, lastPurchaseDate } = createCustomerDto;

    const customer = await this.prisma.customer.create({
      data: {
        name: createCustomerDto.name,
        phone: createCustomerDto.phone,
        companyId,
        lastPurchaseDate: createCustomerDto.lastPurchaseDate
          ? new Date(createCustomerDto.lastPurchaseDate)
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
    const { name, phone, lastPurchaseDate } = data;

    const result = await this.prisma.customer.updateMany({
      where: this.customerTenantWhere(id, companyId),
      data: {
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(lastPurchaseDate && {
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
