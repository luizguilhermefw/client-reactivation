import { CustomerGender } from '@prisma/client';
import { normalizeCustomerImportRow } from './customer-import-normalizer';

describe('normalizeCustomerImportRow', () => {
  const today = new Date('2026-08-13T12:00:00.000Z');
  const normalize = (values: Record<string, unknown>) =>
    normalizeCustomerImportRow({ rowNumber: 2, values }, today);

  it('normalizes phone, city, UF, aliases and accepted date formats', () => {
    expect(
      normalize({
        name: '  Maria   Silva ',
        phone: '(45) 99999-9999',
        gender: 'FEMININO',
        city: '  Foz   do Iguaçu ',
        state: 'pr',
        birthDate: '1990-01-02',
        lastPurchaseDate: '12/08/2026',
      }),
    ).toEqual({
      rowNumber: 2,
      data: {
        name: 'Maria Silva',
        phone: '5545999999999',
        gender: CustomerGender.FEMALE,
        city: 'Foz do Iguaçu',
        state: 'PR',
        birthDate: '1990-01-02',
        lastPurchaseDate: '2026-08-12',
      },
      errors: [],
    });
  });

  it('preserves a phone already prefixed with 55', () => {
    expect(normalize({ name: 'Ana', phone: '5545999999999' }).data.phone).toBe(
      '5545999999999',
    );
  });

  it.each([
    ['45 3333-4444', '554533334444'],
    ['5545999999999', '5545999999999'],
    ['554533334444', '554533334444'],
  ])('accepts plausible phone %s', (phone, expected) => {
    const result = normalize({ name: 'Ana', phone });
    expect(result.data.phone).toBe(expected);
    expect(result.errors).toEqual([]);
  });

  it.each(['1', '1234', '999999', '5512'])(
    'marks phone %s as INVALID_PHONE',
    (phone) => {
      expect(normalize({ name: 'Ana', phone }).errors).toContainEqual(
        expect.objectContaining({ field: 'phone', code: 'INVALID_PHONE' }),
      );
    },
  );

  it.each([
    ['F', CustomerGender.FEMALE],
    ['MASCULINO', CustomerGender.MALE],
    ['OUTROS', CustomerGender.OTHER],
    ['NÃO INFORMADO', CustomerGender.UNSPECIFIED],
    ['', CustomerGender.UNSPECIFIED],
  ])('maps gender alias %j', (gender, expected) => {
    expect(
      normalize({ name: 'Ana', phone: '45999999999', gender }).data.gender,
    ).toBe(expected);
  });

  it('accepts a real Excel Date and optional empty values as null', () => {
    const result = normalize({
      name: 'Ana',
      phone: '45999999999',
      birthDate: new Date('1990-05-10T00:00:00.000Z'),
      lastPurchaseDate: '',
      city: '',
      state: '',
    });

    expect(result.data).toEqual(
      expect.objectContaining({
        birthDate: '1990-05-10',
        lastPurchaseDate: null,
        city: null,
        state: null,
      }),
    );
    expect(result.errors).toEqual([]);
  });

  it.each([
    [{ name: '', phone: '45999999999' }, 'REQUIRED_NAME'],
    [{ name: 'Ana', phone: '' }, 'REQUIRED_PHONE'],
    [
      { name: 'Ana', phone: '45999999999', gender: 'INVALID' },
      'INVALID_GENDER',
    ],
    [{ name: 'Ana', phone: '45999999999', state: 'ZZ' }, 'INVALID_STATE'],
    [
      { name: 'Ana', phone: '45999999999', birthDate: '31/02/2020' },
      'INVALID_BIRTH_DATE',
    ],
    [
      { name: 'Ana', phone: '45999999999', birthDate: '14/08/2026' },
      'INVALID_BIRTH_DATE',
    ],
    [
      { name: 'Ana', phone: '45999999999', lastPurchaseDate: '14/08/2026' },
      'INVALID_LAST_PURCHASE_DATE',
    ],
  ])('marks invalid row with %s', (values, code) => {
    expect(normalize(values).errors).toEqual([
      expect.objectContaining({ code }),
    ]);
  });
});
