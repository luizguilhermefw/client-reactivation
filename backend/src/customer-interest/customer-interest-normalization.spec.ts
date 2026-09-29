import {
  CustomerInterestNameValidationError,
  normalizeCustomerInterestName,
} from './customer-interest-normalization';

describe('customer interest name normalization', () => {
  it('trims, collapses internal spaces and creates a lowercase identity', () => {
    expect(normalizeCustomerInterestName('  New   Balance  ')).toEqual({
      name: 'New Balance',
      normalizedName: 'new balance',
    });
  });

  it.each(['', '   '])('rejects empty normalized name %j', (value) => {
    expect(() => normalizeCustomerInterestName(value)).toThrow(
      CustomerInterestNameValidationError,
    );
  });
});
