import { CustomerContactConsentStatus, CustomerGender } from '@prisma/client';
import {
  CUSTOMER_PUBLIC_SELECT,
  toCustomerPublicResponse,
} from './customer-public-response';

describe('Customer public response CPF safety', () => {
  const cpfStorageFields = [
    'cpfEncrypted',
    'cpfEncryptionIv',
    'cpfEncryptionAuthTag',
    'cpfEncryptionKeyVersion',
    'cpfLookupHash',
    'cpfLookupKeyVersion',
  ] as const;

  it('never selects CPF cryptographic storage fields', () => {
    for (const field of cpfStorageFields) {
      expect(CUSTOMER_PUBLIC_SELECT).not.toHaveProperty(field);
    }
  });

  it('drops CPF cryptographic storage fields from a defensive projection', () => {
    const publicCustomer = {
      id: 'customer-1',
      name: 'Maria',
      phone: '5545999999999',
      gender: CustomerGender.UNSPECIFIED,
      city: null,
      state: null,
      lastPurchaseDate: null,
      birthDate: null,
      isActiveForAutomation: true,
      contactConsentStatus: CustomerContactConsentStatus.UNKNOWN,
      consentGrantedAt: null,
      optedOutAt: null,
      companyId: 'company-1',
      createdAt: new Date('2026-09-25T00:00:00.000Z'),
      cpfEncrypted: 'ciphertext',
      cpfEncryptionIv: 'iv',
      cpfEncryptionAuthTag: 'tag',
      cpfEncryptionKeyVersion: 'v1',
      cpfLookupHash: 'a'.repeat(64),
      cpfLookupKeyVersion: 'v1',
    };

    const result = toCustomerPublicResponse(publicCustomer);

    for (const field of cpfStorageFields) {
      expect(result).not.toHaveProperty(field);
    }
  });
});
