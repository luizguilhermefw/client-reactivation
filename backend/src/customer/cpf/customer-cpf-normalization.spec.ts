import {
  assertValidCpf,
  CustomerCpfValidationError,
  normalizeCpf,
} from './customer-cpf-normalization';

describe('Customer CPF normalization', () => {
  const validCpf = '52998224725';

  it.each([
    ['529.982.247-25', validCpf],
    [validCpf, validCpf],
    ['  529 982 247 25  ', validCpf],
  ])('normalizes %p to digits only', (input, expected) => {
    expect(normalizeCpf(input)).toBe(expected);
  });

  it.each(['', 'abc', '529/982/247-25', '5299822472', '529982247250'])(
    'rejects structurally invalid input without exposing it: %p',
    (input) => {
      expect(() => normalizeCpf(input)).toThrow(CustomerCpfValidationError);

      try {
        normalizeCpf(input);
      } catch (error) {
        expect(String(error)).not.toContain(input || 'empty-input-marker');
      }
    },
  );

  it('returns the normalized CPF when verifier digits are valid', () => {
    expect(assertValidCpf('529.982.247-25')).toBe(validCpf);
  });

  it.each(['5299822472', '529982247250', '52998224724', '11111111111'])(
    'rejects invalid CPF %p with a generic message',
    (input) => {
      expect(() => assertValidCpf(input)).toThrow('CPF inválido');

      try {
        assertValidCpf(input);
      } catch (error) {
        expect(String(error)).not.toContain(input);
      }
    },
  );
});
