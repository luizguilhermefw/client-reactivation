import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomerContactConsentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CustomerConsentService {
  constructor(private readonly prisma: PrismaService) {}

  async updateConsent(
    companyId: string,
    customerId: string,
    status: CustomerContactConsentStatus,
  ) {
    if (
      status !== CustomerContactConsentStatus.GRANTED &&
      status !== CustomerContactConsentStatus.OPTED_OUT
    ) {
      throw new BadRequestException(
        'UNKNOWN cannot be set as a managed consent status',
      );
    }

    const tenantWhere = {
      id: customerId,
      companyId,
    };
    const customer = await this.prisma.customer.findFirst({
      where: tenantWhere,
      select: {
        id: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const now = new Date();
    const consentData =
      status === CustomerContactConsentStatus.GRANTED
        ? {
            contactConsentStatus: CustomerContactConsentStatus.GRANTED,
            consentGrantedAt: now,
            optedOutAt: null,
          }
        : {
            contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
            optedOutAt: now,
          };
    const update = await this.prisma.customer.updateMany({
      where: tenantWhere,
      data: consentData,
    });

    if (update.count !== 1) {
      throw new NotFoundException('Customer not found');
    }

    const updatedCustomer = await this.prisma.customer.findFirst({
      where: tenantWhere,
      select: {
        id: true,
        contactConsentStatus: true,
        consentGrantedAt: true,
        optedOutAt: true,
      },
    });

    if (!updatedCustomer) {
      throw new NotFoundException('Customer not found');
    }

    return updatedCustomer;
  }
}
