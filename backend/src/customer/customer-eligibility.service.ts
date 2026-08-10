import { Injectable } from '@nestjs/common';
import { CustomerContactConsentStatus } from '@prisma/client';

export interface AutomationEligibilityCustomer {
  readonly isActiveForAutomation: boolean;
  readonly contactConsentStatus: CustomerContactConsentStatus;
}

@Injectable()
export class CustomerEligibilityService {
  isOptedOut(customer: AutomationEligibilityCustomer): boolean {
    return (
      customer.contactConsentStatus === CustomerContactConsentStatus.OPTED_OUT
    );
  }

  isContactAllowed(customer: AutomationEligibilityCustomer): boolean {
    return !this.isOptedOut(customer);
  }

  isEligibleForAutomation(customer: AutomationEligibilityCustomer): boolean {
    // UNKNOWN remains allowed temporarily to preserve the current MVP behavior
    // while consent data is migrated. A future strict opt-in policy may change it.
    return (
      customer.isActiveForAutomation === true && this.isContactAllowed(customer)
    );
  }
}
