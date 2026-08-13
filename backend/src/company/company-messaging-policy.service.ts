import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnknownContactPolicy } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UNKNOWN_CONTACT_DECLARATION_TEXT,
  UNKNOWN_CONTACT_DECLARATION_VERSION,
} from './company-messaging-policy.declaration';

@Injectable()
export class CompanyMessagingPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async getPolicy(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { unknownContactPolicy: true },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return {
      unknownContactPolicy: company.unknownContactPolicy,
      declaration: {
        required:
          company.unknownContactPolicy !==
          UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
        version: UNKNOWN_CONTACT_DECLARATION_VERSION,
        text: UNKNOWN_CONTACT_DECLARATION_TEXT,
      },
    };
  }

  async updateUnknownContactPolicy(
    companyId: string,
    userId: string,
    policy: UnknownContactPolicy,
    declarationAccepted?: boolean,
  ) {
    if (policy === UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION) {
      return this.allowUnknownWithDeclaration(
        companyId,
        userId,
        declarationAccepted === true,
      );
    }

    return this.blockUnknown(companyId, userId);
  }

  async allowUnknownWithDeclaration(
    companyId: string,
    userId: string,
    declarationAccepted: boolean,
  ) {
    if (!declarationAccepted) {
      throw new BadRequestException(
        'Declaration acceptance is required to allow UNKNOWN contacts',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const company = await transaction.company.findUnique({
        where: { id: companyId },
        select: { id: true },
      });

      if (!company) {
        throw new NotFoundException('Company not found');
      }

      const user = await transaction.user.findFirst({
        where: {
          id: userId,
          companyId,
        },
        select: {
          id: true,
          companyId: true,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      await transaction.messagingPolicyAcceptance.create({
        data: {
          companyId,
          acceptedByUserId: userId,
          policy: UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
          declarationVersion: UNKNOWN_CONTACT_DECLARATION_VERSION,
          declarationTextSnapshot: UNKNOWN_CONTACT_DECLARATION_TEXT,
        },
      });

      const update = await transaction.company.updateMany({
        where: { id: companyId },
        data: {
          unknownContactPolicy:
            UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
        },
      });

      if (update.count !== 1) {
        throw new NotFoundException('Company not found');
      }

      return {
        unknownContactPolicy:
          UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      };
    });
  }

  async blockUnknown(companyId: string, userId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        companyId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const update = await this.prisma.company.updateMany({
      where: { id: companyId },
      data: {
        unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
      },
    });

    if (update.count !== 1) {
      throw new NotFoundException('Company not found');
    }

    return {
      unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
    };
  }
}
