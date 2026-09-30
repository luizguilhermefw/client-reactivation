export type TrustProxySetting = false | 'loopback';

export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || normalized === 'false') {
    return false;
  }

  if (normalized === 'loopback') {
    return 'loopback';
  }

  throw new Error('Invalid TRUST_PROXY configuration');
}
