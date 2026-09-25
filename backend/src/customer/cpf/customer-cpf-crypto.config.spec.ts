import {
  CustomerCpfCryptoConfig,
  CustomerCpfCryptoConfigurationError,
} from './customer-cpf-crypto.config';

describe('CustomerCpfCryptoConfig', () => {
  const hmacKey = Buffer.alloc(32, 0x11).toString('base64');
  const encryptionKey = Buffer.alloc(32, 0x22).toString('base64');

  const createConfig = (overrides: Record<string, string | undefined> = {}) => {
    const environment: Record<string, string | undefined> = {
      CUSTOMER_CPF_ACTIVE_KEY_VERSION: 'v1',
      CUSTOMER_CPF_HMAC_KEY_V1: hmacKey,
      CUSTOMER_CPF_ENCRYPTION_KEY_V1: encryptionKey,
      ...overrides,
    };
    return new CustomerCpfCryptoConfig((name) => environment[name]);
  };

  it('resolves the active version and distinct canonical base64 keys', () => {
    const config = createConfig();

    expect(config.getActiveKeyVersion()).toBe('v1');
    expect(config.getKeySet('v1')).toEqual({
      keyVersion: 'v1',
      hmacKey: Buffer.alloc(32, 0x11),
      encryptionKey: Buffer.alloc(32, 0x22),
    });
  });

  it.each([
    ['CUSTOMER_CPF_ACTIVE_KEY_VERSION', undefined],
    ['CUSTOMER_CPF_HMAC_KEY_V1', undefined],
    ['CUSTOMER_CPF_HMAC_KEY_V1', Buffer.alloc(31).toString('base64')],
    ['CUSTOMER_CPF_HMAC_KEY_V1', 'not-base64'],
    ['CUSTOMER_CPF_ENCRYPTION_KEY_V1', undefined],
    ['CUSTOMER_CPF_ENCRYPTION_KEY_V1', Buffer.alloc(31).toString('base64')],
    ['CUSTOMER_CPF_ENCRYPTION_KEY_V1', Buffer.alloc(33).toString('base64')],
  ])('fails closed for invalid %s', (variableName, value) => {
    const config = createConfig({ [variableName]: value });

    expect(() => {
      const version = config.getActiveKeyVersion();
      config.getKeySet(version);
    }).toThrow(CustomerCpfCryptoConfigurationError);
  });

  it('rejects reuse of the same key without exposing key material', () => {
    const config = createConfig({
      CUSTOMER_CPF_ENCRYPTION_KEY_V1: hmacKey,
    });

    try {
      config.getKeySet('v1');
      throw new Error('Expected configuration rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(CustomerCpfCryptoConfigurationError);
      expect(String(error)).not.toContain(hmacKey);
    }
  });

  it('rejects an unknown version without exposing configured keys', () => {
    const config = createConfig();

    try {
      config.getKeySet('v2');
      throw new Error('Expected unknown version rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(CustomerCpfCryptoConfigurationError);
      expect(String(error)).not.toContain(hmacKey);
      expect(String(error)).not.toContain(encryptionKey);
    }
  });
});
