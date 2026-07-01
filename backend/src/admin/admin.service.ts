import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listCompanies() {
    return this.prisma.company.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        displayName: true,
        cnpj: true,
        status: true,
        createdAt: true,
        approvedAt: true,
      },
    });
  }
}