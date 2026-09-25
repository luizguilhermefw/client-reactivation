import {
  CustomerCpfCryptoConfig,
  CustomerCpfCryptoConfigurationError,
} from './customer-cpf-crypto.config';
import {
  CustomerCpfCrypto,
  CustomerCpfCryptoError,
  EncryptedCpfPayload,
} from './customer-cpf-crypto';

describe('CustomerCpfCrypto', () => {
  const companyId = 'company-1';
  const normalizedCpf = '52998224725';
  const otherCpf = '11144477735';
  const environment: Record<string, string> = {
    CUSTOMER_CPF_ACTIVE_KEY_VERSION: 'v1',
    CUSTOMER_CPF_HMAC_KEY_V1: Buffer.alloc(32, 0x11).toString('base64'),
    CUSTOMER_CPF_ENCRYPTION_KEY_V1: Buffer.alloc(32, 0x22).toString('base64'),
    CUSTOMER_CPF_HMAC_KEY_V2: Buffer.alloc(32, 0x33).toString('base64'),
    CUSTOMER_CPF_ENCRYPTION_KEY_V2: Buffer.alloc(32, 0x44).toString('base64'),
  };

  const createCrypto = (values = environment) =>
    new CustomerCpfCrypto(new CustomerCpfCryptoConfig((name) => values[name]));

  const mutateBase64 = (value: string): string => {
    const bytes = Buffer.from(value, 'base64');
    bytes[0] ^= 0xff;
    return bytes.toString('base64');
  };

  it('creates a deterministic lowercase SHA-256 HMAC with its key version', () => {
    const crypto = createCrypto();
    const first = crypto.createLookupHash(companyId, normalizedCpf);
    const second = crypto.createLookupHash(companyId, normalizedCpf);

    expect(first).toEqual(second);
    expect(first.keyVersion).toBe('v1');
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('binds lookup hashes to companyId and CPF', () => {
    const crypto = createCrypto();
    const baseline = crypto.createLookupHash(companyId, normalizedCpf).hash;

    expect(crypto.createLookupHash('company-2', normalizedCpf).hash).not.toBe(
      baseline,
    );
    expect(crypto.createLookupHash(companyId, otherCpf).hash).not.toBe(
      baseline,
    );
  });

  it('rejects empty companyId and formatted CPF before HMAC', () => {
    const crypto = createCrypto();

    expect(() => crypto.createLookupHash(' ', normalizedCpf)).toThrow(
      CustomerCpfCryptoError,
    );
    expect(() => crypto.createLookupHash(companyId, '529.982.247-25')).toThrow(
      'CPF inválido',
    );
  });

  it('fails closed when HMAC configuration is missing', () => {
    const values = { ...environment };
    delete values.CUSTOMER_CPF_HMAC_KEY_V1;

    expect(() =>
      createCrypto(values).createLookupHash(companyId, normalizedCpf),
    ).toThrow(CustomerCpfCryptoConfigurationError);
  });

  it('encrypts and decrypts a normalized CPF with AES-256-GCM', () => {
    const crypto = createCrypto();
    const encrypted = crypto.encrypt(companyId, normalizedCpf);

    expect(encrypted.keyVersion).toBe('v1');
    expect(crypto.decrypt(companyId, encrypted)).toBe(normalizedCpf);
  });

  it('uses a fresh random IV for every encryption', () => {
    const crypto = createCrypto();
    const first = crypto.encrypt(companyId, normalizedCpf);
    const second = crypto.encrypt(companyId, normalizedCpf);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('binds ciphertext to companyId through authenticated AAD', () => {
    const crypto = createCrypto();
    const encrypted = crypto.encrypt(companyId, normalizedCpf);

    expect(() => crypto.decrypt('company-2', encrypted)).toThrow(
      CustomerCpfCryptoError,
    );
  });

  it.each(['authTag', 'ciphertext', 'iv'] as const)(
    'rejects tampered %s with a safe error',
    (field) => {
      const crypto = createCrypto();
      const encrypted = crypto.encrypt(companyId, normalizedCpf);
      const tampered: EncryptedCpfPayload = {
        ...encrypted,
        [field]: mutateBase64(encrypted[field]),
      };

      expect(() => crypto.decrypt(companyId, tampered)).toThrow(
        CustomerCpfCryptoError,
      );
    },
  );

  it('decrypts using the key version recorded in the payload', () => {
    const v2Environment = {
      ...environment,
      CUSTOMER_CPF_ACTIVE_KEY_VERSION: 'v2',
    };
    const encryptedWithV2 = createCrypto(v2Environment).encrypt(
      companyId,
      normalizedCpf,
    );

    expect(encryptedWithV2.keyVersion).toBe('v2');
    expect(createCrypto().decrypt(companyId, encryptedWithV2)).toBe(
      normalizedCpf,
    );
  });

  it('fails closed for an unknown payload key version', () => {
    const crypto = createCrypto();
    const encrypted = crypto.encrypt(companyId, normalizedCpf);

    expect(() =>
      crypto.decrypt(companyId, { ...encrypted, keyVersion: 'v9' }),
    ).toThrow(CustomerCpfCryptoConfigurationError);
  });

  it('fails closed for absent or invalid AES keys', () => {
    const missing = { ...environment };
    delete missing.CUSTOMER_CPF_ENCRYPTION_KEY_V1;
    const wrongSize = {
      ...environment,
      CUSTOMER_CPF_ENCRYPTION_KEY_V1: Buffer.alloc(31).toString('base64'),
    };

    expect(() =>
      createCrypto(missing).encrypt(companyId, normalizedCpf),
    ).toThrow(CustomerCpfCryptoConfigurationError);
    expect(() =>
      createCrypto(wrongSize).encrypt(companyId, normalizedCpf),
    ).toThrow(CustomerCpfCryptoConfigurationError);
  });

  it('does not expose CPF or secrets in validation and crypto errors', () => {
    const secret = environment.CUSTOMER_CPF_ENCRYPTION_KEY_V1;
    const crypto = createCrypto();
    const encrypted = crypto.encrypt(companyId, normalizedCpf);

    try {
      crypto.decrypt(companyId, {
        ...encrypted,
        authTag: mutateBase64(encrypted.authTag),
      });
      throw new Error('Expected authenticated decryption failure');
    } catch (error) {
      const message = String(error);
      expect(message).not.toContain(normalizedCpf);
      expect(message).not.toContain(secret);
    }
  });
});
