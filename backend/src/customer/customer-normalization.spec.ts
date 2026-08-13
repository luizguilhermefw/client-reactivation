import {
  isValidCustomerPhone,
  normalizeCustomerPhone,
} from './customer-normalization';

describe('Customer phone normalization', () => {
  it.each([
    ['(45) 99999-9999', '5545999999999'],
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
});
