import { buildBirthDateRange } from './customer-filter.helpers';

describe('buildBirthDateRange', () => {
  const referenceDate = new Date('2026-08-13T12:00:00.000Z');

  it('converts ages 18 through 35 into exact birthday boundaries', () => {
    expect(buildBirthDateRange(18, 35, referenceDate)).toEqual({
      gt: new Date('1990-08-13T23:59:59.999Z'),
      lte: new Date('2008-08-13T23:59:59.999Z'),
    });
  });

  it.each([
    ['exactly 18 today', '2008-08-13T00:00:00.000Z', true],
    ['turns 18 tomorrow', '2008-08-14T00:00:00.000Z', false],
    ['exactly 35 today', '1991-08-13T00:00:00.000Z', true],
    ['turns 36 tomorrow', '1990-08-14T00:00:00.000Z', true],
  ])('%s is included=%s', (_label, birthDateValue, expected) => {
    const range = buildBirthDateRange(18, 35, referenceDate)!;
    const birthDate = new Date(birthDateValue);
    const isIncluded = birthDate > range.gt! && birthDate <= range.lte!;

    expect(isIncluded).toBe(expected);
  });

  it('clamps leap-day boundaries to the last day of February', () => {
    expect(
      buildBirthDateRange(18, undefined, new Date('2028-02-29T12:00:00Z')),
    ).toEqual({ lte: new Date('2010-02-28T23:59:59.999Z') });
  });
});
