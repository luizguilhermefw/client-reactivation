import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CompanyStatus,
  CustomerContactConsentStatus,
  CustomerInterestType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerService } from '../customer/customer.service';
import { isValidCustomerRegistrationPublicId } from './customer-registration-public-id';
import { PublicCustomerRegistrationDto } from './dto/public-customer-registration.dto';

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
  private static readonly MAX_TRANSACTION_ATTEMPTS = 3;
  private readonly unavailableMessage = 'Cadastro indisponível';
  private readonly publicConflictMessage =
    'Não foi possível concluir o cadastro com os dados informados.';

  constructor(
    private readonly prisma: PrismaService,
    private readonly customerService: CustomerService,
  ) {}

  async getBootstrap(
    publicId: string,
  ): Promise<PublicCustomerRegistrationResponse> {
    this.assertValidPublicId(publicId);
    const link = await this.resolveAvailableLink(this.prisma, publicId);

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

  async submit(
    publicId: string,
    dto: PublicCustomerRegistrationDto,
  ): Promise<{ success: true; message: string }> {
    this.assertValidPublicId(publicId);

    for (
      let attempt = 1;
      attempt <= PublicCustomerRegistrationService.MAX_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const link = await this.resolveAvailableLink(transaction, publicId);
            const interestOptions =
              await transaction.customerInterestOption.findMany({
                where: {
                  companyId: link.company.id,
                  active: true,
                  id: { in: dto.interestOptionIds },
                },
                select: { id: true },
              });

            if (interestOptions.length !== dto.interestOptionIds.length) {
              throw new BadRequestException(
                'Uma ou mais opções de interesse são inválidas.',
              );
            }

            const { contactConsent, interestOptionIds, ...createCustomerDto } =
              dto;
            const consentAt = new Date();
            const customer = await this.customerService.createWithClient(
              createCustomerDto,
              link.company.id,
              transaction,
              contactConsent
                ? {
                    contactConsentStatus: CustomerContactConsentStatus.GRANTED,
                    consentGrantedAt: consentAt,
                    optedOutAt: null,
                  }
                : {
                    contactConsentStatus:
                      CustomerContactConsentStatus.OPTED_OUT,
                    consentGrantedAt: null,
                    optedOutAt: consentAt,
                  },
            );

            if (interestOptionIds.length > 0) {
              await transaction.customerInterest.createMany({
                data: interestOptionIds.map((interestOptionId) => ({
                  companyId: link.company.id,
                  customerId: customer.id,
                  interestOptionId,
                })),
              });
            }

            return {
              success: true as const,
              message: 'Cadastro realizado com sucesso.',
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          attempt <
            PublicCustomerRegistrationService.MAX_TRANSACTION_ATTEMPTS &&
          this.hasPrismaCode(error, 'P2034')
        ) {
          continue;
        }
        if (error instanceof ConflictException) {
          throw new ConflictException(this.publicConflictMessage);
        }
        throw error;
      }
    }

    throw new Error('Unreachable transaction retry state');
  }

  private async resolveAvailableLink(
    client: Pick<PrismaService, 'customerRegistrationLink'>,
    publicId: string,
  ) {
    const link = await client.customerRegistrationLink.findUnique({
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
      throw new NotFoundException(this.unavailableMessage);
    }
    return link;
  }

  private assertValidPublicId(publicId: string): void {
    if (!isValidCustomerRegistrationPublicId(publicId)) {
      throw new NotFoundException(this.unavailableMessage);
    }
  }

  private hasPrismaCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code
    );
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
