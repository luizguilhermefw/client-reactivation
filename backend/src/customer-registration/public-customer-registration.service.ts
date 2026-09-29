import { Injectable, NotFoundException } from '@nestjs/common';
import { CompanyStatus, CustomerInterestType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const PUBLIC_INTEREST_SELECT = {
  id: true,
  type: true,
  name: true,
} as const satisfies Prisma.CustomerInterestOptionSelect;

type PublicInterest = Prisma.CustomerInterestOptionGetPayload<{
  select: typeof PUBLIC_INTEREST_SELECT;
}>;

export interface PublicCustomerRegistrationResponse {
  company: { displayName: string };
  interests: {
    categories: PublicInterest[];
    brands: PublicInterest[];
  };
}

@Injectable()
export class PublicCustomerRegistrationService {
  constructor(private readonly prisma: PrismaService) {}

  async getBootstrap(
    publicId: string,
  ): Promise<PublicCustomerRegistrationResponse> {
    const link = await this.prisma.customerRegistrationLink.findUnique({
      where: { publicId },
      select: {
        active: true,
        company: {
          select: { id: true, displayName: true, status: true },
        },
      },
    });

    if (
      !link?.active ||
      !link.company ||
      link.company.status !== CompanyStatus.ACTIVE
    ) {
      throw new NotFoundException('Cadastro indisponível');
    }

    const options = await this.prisma.customerInterestOption.findMany({
      where: { companyId: link.company.id, active: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: PUBLIC_INTEREST_SELECT,
    });

    return {
      company: { displayName: link.company.displayName },
      interests: this.groupInterests(options),
    };
  }

  private groupInterests(options: PublicInterest[]) {
    return {
      categories: options.filter(
        ({ type }) => type === CustomerInterestType.CATEGORY,
      ),
      brands: options.filter(({ type }) => type === CustomerInterestType.BRAND),
    };
  }
}
