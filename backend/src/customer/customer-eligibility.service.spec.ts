import { CustomerContactConsentStatus } from '@prisma/client';
import {
  AutomationEligibilityCustomer,
  CustomerEligibilityService,
} from './customer-eligibility.service';

describe('CustomerEligibilityService', () => {
  const service = new CustomerEligibilityService();

  it.each([
    [true, CustomerContactConsentStatus.UNKNOWN, true],
    [true, CustomerContactConsentStatus.GRANTED, true],
    [true, CustomerContactConsentStatus.OPTED_OUT, false],
    [false, CustomerContactConsentStatus.UNKNOWN, false],
    [false, CustomerContactConsentStatus.GRANTED, false],
    [false, CustomerContactConsentStatus.OPTED_OUT, false],
  ])(
    'active=%s e consent=%s resulta em eligible=%s',
    (isActiveForAutomation, contactConsentStatus, expected) => {
      const customer: AutomationEligibilityCustomer = {
        isActiveForAutomation,
        contactConsentStatus,
      };

      expect(service.isEligibleForAutomation(customer)).toBe(expected);
    },
  );

  it('considera UNKNOWN temporariamente permitido por compatibilidade', () => {
    const customer: AutomationEligibilityCustomer = {
      isActiveForAutomation: true,
      contactConsentStatus: CustomerContactConsentStatus.UNKNOWN,
    };

    expect(service.isOptedOut(customer)).toBe(false);
    expect(service.isContactAllowed(customer)).toBe(true);
  });

  it('considera OPTED_OUT um bloqueio de contato', () => {
    const customer: AutomationEligibilityCustomer = {
      isActiveForAutomation: true,
      contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
    };

    expect(service.isOptedOut(customer)).toBe(true);
    expect(service.isContactAllowed(customer)).toBe(false);
  });

  it('não modifica o objeto recebido', () => {
    const customer = Object.freeze<AutomationEligibilityCustomer>({
      isActiveForAutomation: true,
      contactConsentStatus: CustomerContactConsentStatus.GRANTED,
    });
    const before = { ...customer };

    expect(service.isEligibleForAutomation(customer)).toBe(true);
    expect(customer).toEqual(before);
  });
});
