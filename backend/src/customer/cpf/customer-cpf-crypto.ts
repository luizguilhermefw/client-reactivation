import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { CustomerCpfCryptoConfig } from './customer-cpf-crypto.config';
import {
  assertValidCpf,
  CustomerCpfValidationError,
} from './customer-cpf-normalization';

const CPF_CRYPTO_DOMAIN = 'customer-cpf';
const AES_ALGORITHM = 'aes-256-gcm';
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;

export interface CustomerCpfLookupHash {
  keyVersion: string;
  hash: string;
}

export interface EncryptedCpfPayload {
  keyVersion: string;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export class CustomerCpfCryptoError extends Error {
  readonly name = 'CustomerCpfCryptoError';

  constructor(message = 'Customer CPF cryptographic operation failed') {
    super(message);
  }
}

export type CustomerCpfRandomBytes = (size: number) => Buffer;

export class CustomerCpfCrypto {
  constructor(
    private readonly config: CustomerCpfCryptoConfig,
    private readonly generateRandomBytes: CustomerCpfRandomBytes = randomBytes,
  ) {}

  createLookupHash(
    companyId: string,
    normalizedCpf: string,
    keyVersion = this.config.getActiveKeyVersion(),
  ): CustomerCpfLookupHash {
    const tenant = this.assertCompanyId(companyId);
    const cpf = this.assertNormalizedCpf(normalizedCpf);
    const { hmacKey } = this.config.getKeySet(keyVersion);
    const material = serializeParts([
      CPF_CRYPTO_DOMAIN,
      tenant,
      keyVersion,
      cpf,
    ]);

    return {
      keyVersion,
      hash: createHmac('sha256', hmacKey).update(material).digest('hex'),
    };
  }

  encrypt(companyId: string, normalizedCpf: string): EncryptedCpfPayload {
    const tenant = this.assertCompanyId(companyId);
    const cpf = this.assertNormalizedCpf(normalizedCpf);
    const keyVersion = this.config.getActiveKeyVersion();
    const { encryptionKey } = this.config.getKeySet(keyVersion);
    const iv = this.generateRandomBytes(GCM_IV_BYTES);

    if (!Buffer.isBuffer(iv) || iv.length !== GCM_IV_BYTES) {
      throw new CustomerCpfCryptoError();
    }

    const cipher = createCipheriv(AES_ALGORITHM, encryptionKey, iv, {
      authTagLength: GCM_AUTH_TAG_BYTES,
    });
    cipher.setAAD(this.createAad(tenant, keyVersion));
    const ciphertext = Buffer.concat([
      cipher.update(cpf, 'utf8'),
      cipher.final(),
    ]);

    return {
      keyVersion,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(companyId: string, payload: EncryptedCpfPayload): string {
    const tenant = this.assertCompanyId(companyId);
    const keyVersion = this.assertKeyVersion(payload?.keyVersion);
    const { encryptionKey } = this.config.getKeySet(keyVersion);

    try {
      const iv = decodeCanonicalBase64(payload.iv);
      const ciphertext = decodeCanonicalBase64(payload.ciphertext);
      const authTag = decodeCanonicalBase64(payload.authTag);

      if (
        iv.length !== GCM_IV_BYTES ||
        ciphertext.length === 0 ||
        authTag.length !== GCM_AUTH_TAG_BYTES
      ) {
        throw new CustomerCpfCryptoError();
      }

      const decipher = createDecipheriv(AES_ALGORITHM, encryptionKey, iv, {
        authTagLength: GCM_AUTH_TAG_BYTES,
      });
      decipher.setAAD(this.createAad(tenant, keyVersion));
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');

      return this.assertNormalizedCpf(decrypted);
    } catch (error) {
      if (error instanceof CustomerCpfValidationError) {
        throw new CustomerCpfCryptoError();
      }
      if (error instanceof CustomerCpfCryptoError) {
        throw error;
      }
      throw new CustomerCpfCryptoError();
    }
  }

  private createAad(companyId: string, keyVersion: string): Buffer {
    return serializeParts([CPF_CRYPTO_DOMAIN, companyId, keyVersion]);
  }

  private assertCompanyId(companyId: string): string {
    const normalized = typeof companyId === 'string' ? companyId.trim() : '';

    if (!normalized) {
      throw new CustomerCpfCryptoError('Company context is required');
    }

    return normalized;
  }

  private assertNormalizedCpf(value: string): string {
    const normalized = assertValidCpf(value);

    if (normalized !== value) {
      throw new CustomerCpfValidationError();
    }

    return normalized;
  }

  private assertKeyVersion(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9]+$/.test(value)) {
      throw new CustomerCpfCryptoError();
    }

    return value;
  }
}

function serializeParts(parts: string[]): Buffer {
  return Buffer.concat(
    parts.flatMap((part) => {
      const value = Buffer.from(part, 'utf8');
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(value.length);
      return [length, value];
    }),
  );
}

function decodeCanonicalBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || !value) {
    throw new CustomerCpfCryptoError();
  }

  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0 || decoded.toString('base64') !== value) {
    throw new CustomerCpfCryptoError();
  }

  return decoded;
}
