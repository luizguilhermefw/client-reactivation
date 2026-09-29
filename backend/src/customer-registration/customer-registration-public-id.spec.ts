import { isValidCustomerRegistrationPublicId } from './customer-registration-public-id';

describe('isValidCustomerRegistrationPublicId', () => {
  it('accepts exactly 43 base64url characters', () => {
    expect(
      isValidCustomerRegistrationPublicId(
        'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE',
      ),
    ).toBe(true);
  });

  it.each([
    '',
    'short',
    'A'.repeat(42),
    'A'.repeat(44),
    `${'A'.repeat(42)}+`,
    `${'A'.repeat(42)}/`,
    `${'A'.repeat(42)}=`,
  ])('rejects malformed value %j', (value) => {
    expect(isValidCustomerRegistrationPublicId(value)).toBe(false);
  });
});
