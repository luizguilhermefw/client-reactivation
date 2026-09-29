import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerRegistrationPublicIdGenerator } from './customer-registration-public-id.generator';

const PUBLIC_LINK_SELECT = {
  publicId: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CustomerRegistrationLinkSelect;

type PublicLinkRecord = Prisma.CustomerRegistrationLinkGetPayload<{
  select: typeof PUBLIC_LINK_SELECT;
}>;

export interface CustomerRegistrationLinkResponse extends PublicLinkRecord {
  publicPath: string;
}

@Injectable()
export class CustomerRegistrationLinkService {
  private static readonly MAX_PUBLIC_ID_ATTEMPTS = 3;
  private readonly notFoundMessage = 'Link de cadastro não encontrado';
  private readonly duplicateCompanyMessage =
    'A empresa já possui um link de cadastro.';

  constructor(
    private readonly prisma: PrismaService,
    private readonly publicIdGenerator: CustomerRegistrationPublicIdGenerator,
  ) {}

  async get(companyId: string): Promise<CustomerRegistrationLinkResponse> {
    const link = await this.prisma.customerRegistrationLink.findUnique({
      where: { companyId },
      select: PUBLIC_LINK_SELECT,
    });
    if (!link) throw new NotFoundException(this.notFoundMessage);
    return this.toResponse(link);
  }

  async create(companyId: string): Promise<CustomerRegistrationLinkResponse> {
    const existing = await this.prisma.customerRegistrationLink.findUnique({
      where: { companyId },
      select: { id: true },
    });
    if (existing) throw new ConflictException(this.duplicateCompanyMessage);

    for (
      let attempt = 1;
      attempt <= CustomerRegistrationLinkService.MAX_PUBLIC_ID_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const link = await this.prisma.customerRegistrationLink.create({
          data: {
            companyId,
            publicId: this.publicIdGenerator.generate(),
          },
          select: PUBLIC_LINK_SELECT,
        });
        return this.toResponse(link);
      } catch (error) {
        if (this.isCompanyUniqueError(error)) {
          throw new ConflictException(this.duplicateCompanyMessage);
        }
        if (
          this.isPublicIdUniqueError(error) &&
          attempt < CustomerRegistrationLinkService.MAX_PUBLIC_ID_ATTEMPTS
        ) {
          continue;
        }
        if (this.isPublicIdUniqueError(error)) {
          throw new ServiceUnavailableException(
            'Não foi possível gerar o link de cadastro.',
          );
        }
        throw error;
      }
    }

    throw new ServiceUnavailableException(
      'Não foi possível gerar o link de cadastro.',
    );
  }

  async rotate(companyId: string): Promise<CustomerRegistrationLinkResponse> {
    const existing = await this.prisma.customerRegistrationLink.findUnique({
      where: { companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(this.notFoundMessage);

    for (
      let attempt = 1;
      attempt <= CustomerRegistrationLinkService.MAX_PUBLIC_ID_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const link = await this.prisma.customerRegistrationLink.update({
          where: { companyId },
          data: { publicId: this.publicIdGenerator.generate() },
          select: PUBLIC_LINK_SELECT,
        });
        return this.toResponse(link);
      } catch (error) {
        if (
          this.isPublicIdUniqueError(error) &&
          attempt < CustomerRegistrationLinkService.MAX_PUBLIC_ID_ATTEMPTS
        ) {
          continue;
        }
        if (this.isPublicIdUniqueError(error)) {
          throw new ServiceUnavailableException(
            'Não foi possível rotacionar o link de cadastro.',
          );
        }
        throw error;
      }
    }

    throw new ServiceUnavailableException(
      'Não foi possível rotacionar o link de cadastro.',
    );
  }

  async updateStatus(
    companyId: string,
    active: boolean,
  ): Promise<CustomerRegistrationLinkResponse> {
    const result = await this.prisma.customerRegistrationLink.updateMany({
      where: { companyId },
      data: { active },
    });
    if (result.count === 0) {
      throw new NotFoundException(this.notFoundMessage);
    }
    return this.get(companyId);
  }

  private toResponse(link: PublicLinkRecord): CustomerRegistrationLinkResponse {
    return {
      ...link,
      publicPath: `/register/${link.publicId}`,
    };
  }

  private isCompanyUniqueError(error: unknown): boolean {
    return this.isUniqueErrorFor(
      error,
      'companyId',
      'CustomerRegistrationLink_companyId_key',
    );
  }

  private isPublicIdUniqueError(error: unknown): boolean {
    return this.isUniqueErrorFor(
      error,
      'publicId',
      'CustomerRegistrationLink_publicId_key',
    );
  }

  private isUniqueErrorFor(
    error: unknown,
    field: string,
    constraint: string,
  ): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.map(String)
      : typeof target === 'string'
        ? [target]
        : [];
    return fields.includes(field) || fields.join(' ').includes(constraint);
  }
}
