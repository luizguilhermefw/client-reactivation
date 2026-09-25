import { timingSafeEqual } from 'node:crypto';

export type CustomerCpfEnvironmentReader = (
  variableName: string,
) => string | undefined;

export interface CustomerCpfKeySet {
  keyVersion: string;
  hmacKey: Buffer;
  encryptionKey: Buffer;
}

export class CustomerCpfCryptoConfigurationError extends Error {
  readonly name = 'CustomerCpfCryptoConfigurationError';

  constructor(variableName?: string) {
    super(
      variableName
        ? `Customer CPF crypto configuration is invalid: ${variableName}`
        : 'Customer CPF crypto configuration is invalid',
    );
  }
}

const ACTIVE_KEY_VERSION_VARIABLE = 'CUSTOMER_CPF_ACTIVE_KEY_VERSION';
const KEY_VERSION_PATTERN = /^[A-Za-z0-9]+$/;
const MINIMUM_HMAC_KEY_BYTES = 32;
const AES_256_KEY_BYTES = 32;

export class CustomerCpfCryptoConfig {
  constructor(
    private readonly readEnvironment: CustomerCpfEnvironmentReader = (
      variableName,
    ) => process.env[variableName],
  ) {}

  getActiveKeyVersion(): string {
    const keyVersion = this.readEnvironment(
      ACTIVE_KEY_VERSION_VARIABLE,
    )?.trim();

    if (!keyVersion || !KEY_VERSION_PATTERN.test(keyVersion)) {
      throw new CustomerCpfCryptoConfigurationError(
        ACTIVE_KEY_VERSION_VARIABLE,
      );
    }

    return keyVersion;
  }

  getKeySet(keyVersion: string): CustomerCpfKeySet {
    if (!keyVersion || !KEY_VERSION_PATTERN.test(keyVersion)) {
      throw new CustomerCpfCryptoConfigurationError();
    }

    const environmentSuffix = keyVersion.toUpperCase();
    const hmacVariable = `CUSTOMER_CPF_HMAC_KEY_${environmentSuffix}`;
    const encryptionVariable = `CUSTOMER_CPF_ENCRYPTION_KEY_${environmentSuffix}`;
    const hmacKey = this.readBase64Key(hmacVariable, MINIMUM_HMAC_KEY_BYTES);
    const encryptionKey = this.readBase64Key(
      encryptionVariable,
      AES_256_KEY_BYTES,
      AES_256_KEY_BYTES,
    );

    if (
      hmacKey.length === encryptionKey.length &&
      timingSafeEqual(hmacKey, encryptionKey)
    ) {
      throw new CustomerCpfCryptoConfigurationError();
    }

    return { keyVersion, hmacKey, encryptionKey };
  }

  private readBase64Key(
    variableName: string,
    minimumBytes: number,
    exactBytes?: number,
  ): Buffer {
    const encoded = this.readEnvironment(variableName)?.trim();

    if (!encoded) {
      throw new CustomerCpfCryptoConfigurationError(variableName);
    }

    const decoded = Buffer.from(encoded, 'base64');
    const isCanonicalBase64 =
      decoded.length > 0 && decoded.toString('base64') === encoded;
    const hasValidLength =
      exactBytes === undefined
        ? decoded.length >= minimumBytes
        : decoded.length === exactBytes;

    if (!isCanonicalBase64 || !hasValidLength) {
      throw new CustomerCpfCryptoConfigurationError(variableName);
    }

    return decoded;
  }
}
