import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MessagingPolicyAction, UnknownContactPolicy } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UNKNOWN_CONTACT_DECLARATION_TEXT,
  UNKNOWN_CONTACT_DECLARATION_VERSION,
  OPT_OUT_INSTRUCTIONS_DECLARATION_TEXT,
  OPT_OUT_INSTRUCTIONS_DECLARATION_VERSION,
  OPT_OUT_INSTRUCTIONS_ENABLED_AUDIT_TEXT,
} from './company-messaging-policy.declaration';

@Injectable()
export class CompanyMessagingPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async getPolicy(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        unknownContactPolicy: true,
        includeOptOutInstructions: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return {
      unknownContactPolicy: company.unknownContactPolicy,
      includeOptOutInstructions: company.includeOptOutInstructions,
      declaration: {
        required:
          company.unknownContactPolicy !==
          UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
        version: UNKNOWN_CONTACT_DECLARATION_VERSION,
        text: UNKNOWN_CONTACT_DECLARATION_TEXT,
      },
      optOutInstructionsDeclaration: {
        required: company.includeOptOutInstructions,
        version: OPT_OUT_INSTRUCTIONS_DECLARATION_VERSION,
        text: OPT_OUT_INSTRUCTIONS_DECLARATION_TEXT,
      },
    };
  }

  async updateOptOutInstructions(
    companyId: string,
    userId: string,
    includeOptOutInstructions: boolean,
    responsibilityAcknowledged?: boolean,
  ) {
    if (!includeOptOutInstructions && responsibilityAcknowledged !== true) {
      throw new BadRequestException(
        'Responsibility acknowledgement is required to disable opt-out instructions',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const company = await transaction.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          includeOptOutInstructions: true,
        },
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

      if (company.includeOptOutInstructions === includeOptOutInstructions) {
        return { includeOptOutInstructions };
      }

      const disabling = !includeOptOutInstructions;
      await transaction.messagingPolicyAcceptance.create({
        data: {
          companyId,
          acceptedByUserId: userId,
          action: disabling
            ? MessagingPolicyAction.DISABLED_OPT_OUT_INSTRUCTIONS
            : MessagingPolicyAction.ENABLED_OPT_OUT_INSTRUCTIONS,
          responsibilityAcknowledged: disabling,
          declarationVersion: OPT_OUT_INSTRUCTIONS_DECLARATION_VERSION,
          declarationTextSnapshot: disabling
            ? OPT_OUT_INSTRUCTIONS_DECLARATION_TEXT
            : OPT_OUT_INSTRUCTIONS_ENABLED_AUDIT_TEXT,
        },
      });

      const update = await transaction.company.updateMany({
        where: {
          id: companyId,
          includeOptOutInstructions: company.includeOptOutInstructions,
        },
        data: { includeOptOutInstructions },
      });

      if (update.count !== 1) {
        throw new BadRequestException('Messaging policy changed concurrently');
      }

      return { includeOptOutInstructions };
    });
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
