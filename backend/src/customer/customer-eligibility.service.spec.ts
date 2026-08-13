import {
  CustomerContactConsentStatus,
  UnknownContactPolicy,
} from '@prisma/client';
import {
  AutomationEligibilityCustomer,
  CustomerEligibilityService,
} from './customer-eligibility.service';

describe('CustomerEligibilityService', () => {
  const service = new CustomerEligibilityService();

  it.each([
    [
      true,
      CustomerContactConsentStatus.UNKNOWN,
      UnknownContactPolicy.BLOCK_UNKNOWN,
      false,
    ],
    [
      true,
      CustomerContactConsentStatus.UNKNOWN,
      UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      true,
    ],
    [
      true,
      CustomerContactConsentStatus.GRANTED,
      UnknownContactPolicy.BLOCK_UNKNOWN,
      true,
    ],
    [
      true,
      CustomerContactConsentStatus.GRANTED,
      UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      true,
    ],
    [
      true,
      CustomerContactConsentStatus.OPTED_OUT,
      UnknownContactPolicy.BLOCK_UNKNOWN,
      false,
    ],
    [
      true,
      CustomerContactConsentStatus.OPTED_OUT,
      UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      false,
    ],
    [
      false,
      CustomerContactConsentStatus.UNKNOWN,
      UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      false,
    ],
    [
      false,
      CustomerContactConsentStatus.GRANTED,
      UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      false,
    ],
  ])(
    'active=%s, consent=%s e policy=%s resulta em eligible=%s',
    (isActiveForAutomation, contactConsentStatus, policy, expected) => {
      const customer: AutomationEligibilityCustomer = {
        isActiveForAutomation,
        contactConsentStatus,
      };

      expect(service.isEligibleForAutomation(customer, policy)).toBe(expected);
    },
  );

  it('aplica a política da empresa a UNKNOWN', () => {
    const customer: AutomationEligibilityCustomer = {
      isActiveForAutomation: true,
      contactConsentStatus: CustomerContactConsentStatus.UNKNOWN,
    };

    expect(service.isOptedOut(customer)).toBe(false);
    expect(
      service.isContactAllowed(customer, UnknownContactPolicy.BLOCK_UNKNOWN),
    ).toBe(false);
    expect(
      service.isContactAllowed(
        customer,
        UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      ),
    ).toBe(true);
  });

  it('considera OPTED_OUT um bloqueio de contato', () => {
    const customer: AutomationEligibilityCustomer = {
      isActiveForAutomation: true,
      contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
    };

    expect(service.isOptedOut(customer)).toBe(true);
    expect(
      service.isContactAllowed(
        customer,
        UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      ),
    ).toBe(false);
  });

  it('falha fechado para estado de consentimento inesperado', () => {
    const customer: AutomationEligibilityCustomer = {
      isActiveForAutomation: true,
      contactConsentStatus: 'UNEXPECTED' as CustomerContactConsentStatus,
    };

    expect(
      service.isEligibleForAutomation(
        customer,
        UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      ),
    ).toBe(false);
  });

  it('não modifica o objeto recebido', () => {
    const customer = Object.freeze<AutomationEligibilityCustomer>({
      isActiveForAutomation: true,
      contactConsentStatus: CustomerContactConsentStatus.GRANTED,
    });
    const before = { ...customer };

    expect(
      service.isEligibleForAutomation(
        customer,
        UnknownContactPolicy.BLOCK_UNKNOWN,
      ),
    ).toBe(true);
    expect(customer).toEqual(before);
  });
});
