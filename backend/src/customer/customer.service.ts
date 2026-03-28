import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';

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
}
