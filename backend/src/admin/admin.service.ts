import { PrismaService } from '../../prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';

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

  async activateCompany(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    const updatedCompany = await this.prisma.company.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        approvedAt: new Date(),
      },
    });

    return {
      message: 'Empresa aprovada com sucesso.',
      company: updatedCompany,
    };
  }
  async suspendCompany(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    const updatedCompany = await this.prisma.company.update({
      where: { id },
      data: {
        status: 'SUSPENDED',
      },
    });

    return {
      message: 'Empresa suspensa com sucesso.',
      company: updatedCompany,
    };
  }

  async cancelCompany(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    const updatedCompany = await this.prisma.company.update({
      where: { id },
      data: {
        status: 'CANCELLED',
      },
    });

    return {
      message: 'Empresa cancelada com sucesso.',
      company: updatedCompany,
    };
  }
}
