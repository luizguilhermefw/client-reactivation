import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CustomerContactConsentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerConsentService } from '../customer/customer-consent.service';
import { normalizeInboundOptOutCommand } from './inbound-opt-out-command';
import type { InboundMessage } from './types/inbound-message';

export type InboundOptOutResult =
  | 'opt-out-applied'
  | 'already-opted-out'
  | 'customer-not-found'
  | 'ambiguous-customer'
  | 'not-opt-out-command';

@Injectable()
export class InboundOptOutService {
  private readonly logger = new Logger(InboundOptOutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customerConsentService: CustomerConsentService,
  ) {}

  async process(
    companyId: string,
    message: InboundMessage,
  ): Promise<InboundOptOutResult> {
    const command = normalizeInboundOptOutCommand(message.text);

    if (!command) {
      return this.finish(message, 'not-opt-out-command');
    }

    const customers = await this.prisma.customer.findMany({
      where: {
        companyId,
        phone: message.phone,
      },
      take: 2,
      select: {
        id: true,
        contactConsentStatus: true,
      },
    });

    if (customers.length === 0) {
      return this.finish(message, 'customer-not-found');
    }

    if (customers.length > 1) {
      return this.finish(message, 'ambiguous-customer');
    }

    const customer = customers[0];

    if (
      customer.contactConsentStatus === CustomerContactConsentStatus.OPTED_OUT
    ) {
      return this.finish(message, 'already-opted-out');
    }

    try {
      await this.customerConsentService.updateConsent(
        companyId,
        customer.id,
        CustomerContactConsentStatus.OPTED_OUT,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return this.finish(message, 'customer-not-found');
      }

      throw error;
    }

    return this.finish(message, 'opt-out-applied');
  }

  private finish(
    message: InboundMessage,
    result: InboundOptOutResult,
  ): InboundOptOutResult {
    this.logger.log(
      `Inbound opt-out instance=${message.instanceName} providerMessageId=${message.providerMessageId ?? 'none'} result=${result}`,
    );
    return result;
  }
}
