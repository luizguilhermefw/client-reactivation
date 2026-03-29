import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';


@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCustomerDto: CreateCustomerDto, companyId: string) {
    try {
      const { lastPurchaseDate, ...rest } = createCustomerDto;

      return await this.prisma.customer.create({
        data: {
          ...rest,
          companyId,
          lastPurchaseDate: lastPurchaseDate
            ? new Date(lastPurchaseDate)
            : new Date(),
        },
      });
    } catch (error) {
      console.log('🔥 ERRO REAL:', error);
      throw error;
    }
  }

  async findAll(companyId: string) {
    return this.prisma.customer.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, data: UpdateCustomerDto, companyId: string) {
    const { lastPurchaseDate, ...rest } = data;

    const result = await this.prisma.customer.updateMany({
      where: {
        id,
        companyId,
      },
      data: {
        ...rest,
        ...(lastPurchaseDate && {
          lastPurchaseDate: new Date(lastPurchaseDate),
        }),
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return result;
  }

  async remove(id: string, companyId: string) {
    const result = await this.prisma.customer.deleteMany({
      where: {
        id,
        companyId,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return { message: 'Cliente removido com sucesso' };
  }
}
