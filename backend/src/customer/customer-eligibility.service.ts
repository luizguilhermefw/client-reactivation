import { Injectable } from '@nestjs/common';
import {
  CustomerContactConsentStatus,
  UnknownContactPolicy,
} from '@prisma/client';

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

  isContactAllowed(
    customer: AutomationEligibilityCustomer,
    unknownContactPolicy: UnknownContactPolicy,
  ): boolean {
    switch (customer.contactConsentStatus) {
      case CustomerContactConsentStatus.GRANTED:
        return true;
      case CustomerContactConsentStatus.OPTED_OUT:
        return false;
      case CustomerContactConsentStatus.UNKNOWN:
        return (
          unknownContactPolicy ===
          UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION
        );
      default:
        return false;
    }
  }

  isEligibleForAutomation(
    customer: AutomationEligibilityCustomer,
    unknownContactPolicy: UnknownContactPolicy,
  ): boolean {
    return (
      customer.isActiveForAutomation === true &&
      this.isContactAllowed(customer, unknownContactPolicy)
    );
  }
}
