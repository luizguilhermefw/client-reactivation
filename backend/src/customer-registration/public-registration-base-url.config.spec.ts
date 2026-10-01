import {
  PublicRegistrationBaseUrlConfig,
  PublicRegistrationBaseUrlConfigurationError,
} from './public-registration-base-url.config';

describe('PublicRegistrationBaseUrlConfig', () => {
  const originalValue = process.env.PUBLIC_REGISTRATION_BASE_URL;
  const config = new PublicRegistrationBaseUrlConfig();

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.PUBLIC_REGISTRATION_BASE_URL;
    } else {
      process.env.PUBLIC_REGISTRATION_BASE_URL = originalValue;
    }
  });

  it('does not require configuration during construction', () => {
    delete process.env.PUBLIC_REGISTRATION_BASE_URL;

    expect(() => new PublicRegistrationBaseUrlConfig()).not.toThrow();
  });

  it.each([
    ['http://localhost:5173', 'http://localhost:5173'],
    ['https://app.example.test', 'https://app.example.test'],
    [' https://app.example.test/// ', 'https://app.example.test'],
  ])('accepts and normalizes %s', (value, expected) => {
    process.env.PUBLIC_REGISTRATION_BASE_URL = value;

    expect(config.getRequired()).toBe(expected);
  });

  it.each([
    undefined,
    '',
    'not-a-url',
    'ftp://app.example.test',
    'https://user:password@app.example.test',
    'https://app.example.test?source=test',
    'https://app.example.test#section',
  ])('rejects unavailable or unsafe configuration: %s', (value) => {
    if (value === undefined) {
      delete process.env.PUBLIC_REGISTRATION_BASE_URL;
    } else {
      process.env.PUBLIC_REGISTRATION_BASE_URL = value;
    }

    expect(() => config.getRequired()).toThrow(
      PublicRegistrationBaseUrlConfigurationError,
    );
  });
});
