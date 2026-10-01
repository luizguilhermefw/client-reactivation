import { Injectable } from '@nestjs/common';

export class PublicRegistrationBaseUrlConfigurationError extends Error {
  constructor() {
    super('Public registration base URL is not configured');
    this.name = 'PublicRegistrationBaseUrlConfigurationError';
  }
}

@Injectable()
export class PublicRegistrationBaseUrlConfig {
  getRequired(): string {
    const configuredValue = process.env.PUBLIC_REGISTRATION_BASE_URL?.trim();

    if (!configuredValue) {
      throw new PublicRegistrationBaseUrlConfigurationError();
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(configuredValue);
    } catch {
      throw new PublicRegistrationBaseUrlConfigurationError();
    }

    if (
      !['http:', 'https:'].includes(parsedUrl.protocol) ||
      parsedUrl.username !== '' ||
      parsedUrl.password !== '' ||
      parsedUrl.search !== '' ||
      parsedUrl.hash !== '' ||
      configuredValue.includes('?') ||
      configuredValue.includes('#')
    ) {
      throw new PublicRegistrationBaseUrlConfigurationError();
    }

    return parsedUrl.toString().replace(/\/+$/, '');
  }
}
