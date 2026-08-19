import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CustomerContactConsentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerConsentService } from '../customer/customer-consent.service';
import { getCustomerPhoneIdentityVariants } from '../customer/customer-normalization';
import { normalizeInboundOptOutCommand } from './inbound-opt-out-command';
import type { InboundMessage } from './types/inbound-message';

export type InboundOptOutResult =
  | 'opt-out-applied'
  | 'already-opted-out'
  | 'customer-not-found'
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

    const phoneVariants = getCustomerPhoneIdentityVariants(message.phone);
    if (phoneVariants.length === 0) {
      return this.finish(message, 'customer-not-found');
    }

    const customers = await this.prisma.customer.findMany({
      where: {
        companyId,
        phone: { in: phoneVariants },
      },
      select: {
        id: true,
        contactConsentStatus: true,
      },
    });

    if (customers.length === 0) {
      return this.finish(message, 'customer-not-found');
    }

    const customersToOptOut = customers.filter(
      ({ contactConsentStatus }) =>
        contactConsentStatus !== CustomerContactConsentStatus.OPTED_OUT,
    );
    if (customersToOptOut.length === 0) {
      return this.finish(message, 'already-opted-out');
    }

    let updatedCustomers = 0;
    for (const customer of customersToOptOut) {
      try {
        await this.customerConsentService.updateConsent(
          companyId,
          customer.id,
          CustomerContactConsentStatus.OPTED_OUT,
        );
        updatedCustomers += 1;
      } catch (error) {
        if (error instanceof NotFoundException) {
          continue;
        }

        throw error;
      }
    }

    return this.finish(
      message,
      updatedCustomers > 0 ? 'opt-out-applied' : 'customer-not-found',
    );
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
