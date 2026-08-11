import { normalizeEvolutionPhone } from './phone-normalizer';

describe('normalizeEvolutionPhone', () => {
  it('removes the WhatsApp remoteJid suffix', () => {
    expect(normalizeEvolutionPhone('5545999999999@s.whatsapp.net')).toBe(
      '5545999999999',
    );
  });

  it('removes non-numeric characters', () => {
    expect(normalizeEvolutionPhone('+55 (45) 99999-9999')).toBe(
      '5545999999999',
    );
  });

  it('extracts digits before another Evolution address suffix', () => {
    expect(normalizeEvolutionPhone('5545999999999@lid')).toBe('5545999999999');
  });

  it.each([undefined, null, '', '   ', '@s.whatsapp.net', 'abc', '123'])(
    'returns null for invalid input %p',
    (input) => {
      expect(normalizeEvolutionPhone(input)).toBeNull();
    },
  );

  it('does not add country or area codes', () => {
    expect(normalizeEvolutionPhone('45999999999')).toBe('45999999999');
  });
});
