import {
  getCustomerPhoneIdentityVariants,
  isValidCustomerPhone,
  isLegacyBrazilianMobilePhone,
  normalizeCustomerPhone,
} from './customer-normalization';

describe('Customer phone normalization', () => {
  it.each([
    ['(45) 99999-9999', '5545999999999'],
    ['(45) 9902-9181', '5545999029181'],
    ['(45) 9 9902-9181', '5545999029181'],
    ['+55 45 9902-9181', '5545999029181'],
    ['554599029181', '5545999029181'],
    ['45 3333-4444', '554533334444'],
    ['5545999999999', '5545999999999'],
    ['554533334444', '554533334444'],
  ])('normalizes %s to %s', (input, expected) => {
    const normalized = normalizeCustomerPhone(input);
    expect(normalized).toBe(expected);
    expect(isValidCustomerPhone(normalized)).toBe(true);
  });

  it.each(['', '1', '1234', '999999', '5512'])(
    'rejects implausible phone %j',
    (input) => {
      expect(isValidCustomerPhone(normalizeCustomerPhone(input))).toBe(false);
    },
  );

  it('exposes an explicit legacy-mobile classification', () => {
    expect(isLegacyBrazilianMobilePhone('554599029181')).toBe(true);
    expect(isLegacyBrazilianMobilePhone('554533334444')).toBe(false);
  });

  it('uses the canonical and legacy mobile forms as one identity', () => {
    expect(getCustomerPhoneIdentityVariants('(45) 9 9902-9181')).toEqual([
      '5545999029181',
      '554599029181',
    ]);
  });

  it('does not add a ninth digit or legacy variant to a landline', () => {
    expect(normalizeCustomerPhone('(45) 3333-4444')).toBe('554533334444');
    expect(getCustomerPhoneIdentityVariants('(45) 3333-4444')).toEqual([
      '554533334444',
    ]);
  });
});
