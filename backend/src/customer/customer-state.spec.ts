import {
  isBrazilianStateCode,
  normalizeBrazilianState,
} from './customer-state';

describe('Brazilian state normalization', () => {
  it.each([
    ['pr', 'PR'],
    [' sp ', 'SP'],
    ['', null],
    ['   ', null],
    [null, null],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeBrazilianState(input)).toBe(expected);
  });

  it.each(['ZZ', 'XX', 'PARANA', 'P', '1A'])(
    'rejects %s as an official UF',
    (state) => {
      expect(isBrazilianStateCode(state)).toBe(false);
    },
  );
});
