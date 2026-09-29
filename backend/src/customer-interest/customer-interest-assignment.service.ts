import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomerInterestType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface CustomerInterestSummary {
  id: string;
  type: CustomerInterestType;
  name: string;
  active: boolean;
}

export interface CustomerInterestsResponse {
  categories: CustomerInterestSummary[];
  brands: CustomerInterestSummary[];
}

const ASSIGNMENT_OPTION_SELECT = {
  id: true,
  type: true,
  name: true,
  active: true,
} as const satisfies Prisma.CustomerInterestOptionSelect;

const ASSOCIATION_SELECT = {
  interestOptionId: true,
  interestOption: { select: ASSIGNMENT_OPTION_SELECT },
} as const satisfies Prisma.CustomerInterestSelect;

@Injectable()
export class CustomerInterestAssignmentService {
  private static readonly MAX_TRANSACTION_ATTEMPTS = 3;

  constructor(private readonly prisma: PrismaService) {}

  async get(
    companyId: string,
    customerId: string,
  ): Promise<CustomerInterestsResponse> {
    await this.assertCustomerExists(this.prisma, companyId, customerId);
    const associations = await this.prisma.customerInterest.findMany({
      where: { companyId, customerId },
      select: ASSOCIATION_SELECT,
    });

    return this.toResponse(associations);
  }

  async update(
    companyId: string,
    customerId: string,
    interestOptionIds: string[],
  ): Promise<CustomerInterestsResponse> {
    for (
      let attempt = 1;
      attempt <= CustomerInterestAssignmentService.MAX_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await this.assertCustomerExists(tx, companyId, customerId);

            const currentAssociations = await tx.customerInterest.findMany({
              where: { companyId, customerId },
              select: { interestOptionId: true },
            });
            const requestedOptions = await tx.customerInterestOption.findMany({
              where: { companyId, id: { in: interestOptionIds } },
              select: { id: true, active: true },
            });

            if (requestedOptions.length !== interestOptionIds.length) {
              throw this.invalidOptions();
            }

            const currentIds = new Set(
              currentAssociations.map(
                ({ interestOptionId }) => interestOptionId,
              ),
            );
            if (
              requestedOptions.some(
                ({ id, active }) => !active && !currentIds.has(id),
              )
            ) {
              throw this.invalidOptions();
            }

            const requestedIds = new Set(interestOptionIds);
            const idsToRemove = [...currentIds].filter(
              (id) => !requestedIds.has(id),
            );
            const idsToAdd = interestOptionIds.filter(
              (id) => !currentIds.has(id),
            );

            if (idsToRemove.length > 0) {
              await tx.customerInterest.deleteMany({
                where: {
                  companyId,
                  customerId,
                  interestOptionId: { in: idsToRemove },
                },
              });
            }
            if (idsToAdd.length > 0) {
              await tx.customerInterest.createMany({
                data: idsToAdd.map((interestOptionId) => ({
                  companyId,
                  customerId,
                  interestOptionId,
                })),
                skipDuplicates: true,
              });
            }

            const finalAssociations = await tx.customerInterest.findMany({
              where: { companyId, customerId },
              select: ASSOCIATION_SELECT,
            });
            return this.toResponse(finalAssociations);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          attempt <
            CustomerInterestAssignmentService.MAX_TRANSACTION_ATTEMPTS &&
          this.hasPrismaCode(error, 'P2034')
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new Error('Unreachable transaction retry state');
  }

  private async assertCustomerExists(
    client: Pick<PrismaService, 'customer'> | Prisma.TransactionClient,
    companyId: string,
    customerId: string,
  ): Promise<void> {
    const customer = await client.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
  }

  private invalidOptions(): BadRequestException {
    return new BadRequestException(
      'Uma ou mais opções de interesse são inválidas.',
    );
  }

  private hasPrismaCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code
    );
  }

  private toResponse(
    associations: Array<{
      interestOption: CustomerInterestSummary;
    }>,
  ): CustomerInterestsResponse {
    const categories: CustomerInterestSummary[] = [];
    const brands: CustomerInterestSummary[] = [];

    for (const { interestOption } of associations) {
      (interestOption.type === CustomerInterestType.CATEGORY
        ? categories
        : brands
      ).push(interestOption);
    }
    categories.sort((left, right) =>
      left.name.localeCompare(right.name, 'pt-BR'),
    );
    brands.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));

    return { categories, brands };
  }
}
