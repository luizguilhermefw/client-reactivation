import { PrismaService } from '../../prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CompanyStatus,
  EntitlementFeature,
  EntitlementSource,
} from '@prisma/client';

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
    const updatedCompany = await this.prisma.$transaction(
      async (transaction) => {
        const company = await transaction.company.findUnique({
          where: { id },
        });

        if (!company) {
          throw new NotFoundException('Empresa não encontrada.');
        }

        await transaction.companyEntitlement.upsert({
          where: {
            companyId_feature: {
              companyId: id,
              feature: EntitlementFeature.WHATSAPP_CHANNELS,
            },
          },
          create: {
            companyId: id,
            feature: EntitlementFeature.WHATSAPP_CHANNELS,
            limit: 1,
            source: EntitlementSource.MANUAL,
          },
          update: {},
        });

        return transaction.company.update({
          where: { id },
          data: {
            status: CompanyStatus.ACTIVE,
            approvedAt: company.approvedAt ?? new Date(),
          },
        });
      },
    );

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
