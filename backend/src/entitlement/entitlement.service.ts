import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CompanyEntitlement,
  EntitlementFeature,
  EntitlementSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface SetEntitlementInput {
  companyId: string;
  feature: EntitlementFeature;
  limit: number;
  source: EntitlementSource;
  externalReference?: string | null;
}

@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  async getLimit(
    companyId: string,
    feature: EntitlementFeature,
  ): Promise<number> {
    const entitlement = await this.prisma.companyEntitlement.findUnique({
      where: {
        companyId_feature: {
          companyId,
          feature,
        },
      },
      select: { limit: true },
    });

    return entitlement?.limit ?? 0;
  }

  async setLimit(input: SetEntitlementInput): Promise<CompanyEntitlement> {
    this.assertValidLimit(input.limit);

    const company = await this.prisma.company.findUnique({
      where: { id: input.companyId },
      select: { id: true },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    const data = {
      limit: input.limit,
      source: input.source,
      externalReference: input.externalReference ?? null,
    };

    return this.prisma.companyEntitlement.upsert({
      where: {
        companyId_feature: {
          companyId: input.companyId,
          feature: input.feature,
        },
      },
      create: {
        companyId: input.companyId,
        feature: input.feature,
        ...data,
      },
      update: data,
    });
  }

  setManualLimit(
    companyId: string,
    feature: EntitlementFeature,
    limit: number,
  ): Promise<CompanyEntitlement> {
    return this.setLimit({
      companyId,
      feature,
      limit,
      source: EntitlementSource.MANUAL,
    });
  }

  private assertValidLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new BadRequestException(
        'Entitlement limit must be a non-negative integer',
      );
    }
  }
}
