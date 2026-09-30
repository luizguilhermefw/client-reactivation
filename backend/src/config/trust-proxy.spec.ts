import { parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it.each([undefined, '', '  ', 'false', ' FALSE '])(
    'does not trust a proxy for %p',
    (value) => {
      expect(parseTrustProxy(value)).toBe(false);
    },
  );

  it('accepts the explicit Express loopback trust preset', () => {
    expect(parseTrustProxy(' loopback ')).toBe('loopback');
  });

  it.each(['true', '1', '0', 'uniquelocal', '10.0.0.0/8', 'anything'])(
    'rejects unsupported trust configuration %p',
    (value) => {
      expect(() => parseTrustProxy(value)).toThrow(
        'Invalid TRUST_PROXY configuration',
      );
    },
  );
});
