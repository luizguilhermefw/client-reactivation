import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [CustomerController], // 👈 ESSENCIAL
  providers: [CustomerService, PrismaService],
})
export class CustomerModule {}