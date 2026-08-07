export const MEDIA_READ_URL_CONFIG = Symbol('MEDIA_READ_URL_CONFIG');
export const DEFAULT_MEDIA_READ_URL_TTL_SECONDS = 900;
export const MIN_MEDIA_READ_URL_TTL_SECONDS = 60;
export const MAX_MEDIA_READ_URL_TTL_SECONDS = 3_600;

export interface MediaReadUrlConfig {
  getTtlSeconds(): number;
}

export class MediaReadUrlConfigurationError extends Error {
  readonly name = 'MediaReadUrlConfigurationError';

  constructor() {
    super('MEDIA_READ_URL_TTL_SECONDS must be an integer between 60 and 3600');
  }
}

export class EnvMediaReadUrlConfig implements MediaReadUrlConfig {
  private readonly ttlSeconds: number;

  constructor(
    readValue: () => string | undefined = () =>
      process.env.MEDIA_READ_URL_TTL_SECONDS,
  ) {
    const value = readValue();

    if (value === undefined) {
      this.ttlSeconds = DEFAULT_MEDIA_READ_URL_TTL_SECONDS;
      return;
    }

    const normalizedValue = value.trim();

    if (!/^\d+$/u.test(normalizedValue)) {
      throw new MediaReadUrlConfigurationError();
    }

    const ttlSeconds = Number(normalizedValue);

    if (
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds < MIN_MEDIA_READ_URL_TTL_SECONDS ||
      ttlSeconds > MAX_MEDIA_READ_URL_TTL_SECONDS
    ) {
      throw new MediaReadUrlConfigurationError();
    }

    this.ttlSeconds = ttlSeconds;
  }

  getTtlSeconds(): number {
    return this.ttlSeconds;
  }
}
