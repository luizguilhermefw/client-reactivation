const BRAZIL_COUNTRY_CODE = '55';
const BRAZILIAN_FIXED_LINE_PATTERN = /^[1-9]\d[2-5]\d{7}$/;
const BRAZILIAN_LEGACY_MOBILE_PATTERN = /^[1-9]\d[6-9]\d{7}$/;
const BRAZILIAN_CANONICAL_MOBILE_PATTERN = /^[1-9]\d9[6-9]\d{7}$/;

function brazilianNationalNumber(phoneDigits: string): string | null {
  if (phoneDigits.length === 10 || phoneDigits.length === 11) {
    return phoneDigits;
  }

  if (
    phoneDigits.startsWith(BRAZIL_COUNTRY_CODE) &&
    (phoneDigits.length === 12 || phoneDigits.length === 13)
  ) {
    return phoneDigits.slice(BRAZIL_COUNTRY_CODE.length);
  }

  return null;
}

export function isLegacyBrazilianMobilePhone(phoneDigits: string): boolean {
  const nationalNumber = brazilianNationalNumber(phoneDigits);
  return (
    nationalNumber !== null &&
    BRAZILIAN_LEGACY_MOBILE_PATTERN.test(nationalNumber)
  );
}

export function canonicalizeBrazilianMobilePhone(phoneDigits: string): string {
  const nationalNumber = brazilianNationalNumber(phoneDigits);
  if (!nationalNumber) return phoneDigits;

  const canonicalNationalNumber = BRAZILIAN_LEGACY_MOBILE_PATTERN.test(
    nationalNumber,
  )
    ? `${nationalNumber.slice(0, 2)}9${nationalNumber.slice(2)}`
    : nationalNumber;

  return `${BRAZIL_COUNTRY_CODE}${canonicalNationalNumber}`;
}

export function normalizeCustomerPhone(phone: string): string {
  return canonicalizeBrazilianMobilePhone(phone.replace(/\D/g, ''));
}

export function isValidCustomerPhone(phone: string): boolean {
  if (!/^\d+$/.test(phone) || !phone.startsWith(BRAZIL_COUNTRY_CODE)) {
    return false;
  }

  const nationalNumber = phone.slice(BRAZIL_COUNTRY_CODE.length);
  return (
    BRAZILIAN_FIXED_LINE_PATTERN.test(nationalNumber) ||
    BRAZILIAN_CANONICAL_MOBILE_PATTERN.test(nationalNumber)
  );
}

export function getCustomerPhoneIdentityVariants(phone: string): string[] {
  const canonicalPhone = normalizeCustomerPhone(phone);
  if (!isValidCustomerPhone(canonicalPhone)) return [];

  const nationalNumber = canonicalPhone.slice(BRAZIL_COUNTRY_CODE.length);
  if (!BRAZILIAN_CANONICAL_MOBILE_PATTERN.test(nationalNumber)) {
    return [canonicalPhone];
  }

  const legacyPhone = `${BRAZIL_COUNTRY_CODE}${nationalNumber.slice(
    0,
    2,
  )}${nationalNumber.slice(3)}`;

  return [canonicalPhone, legacyPhone];
}

export function normalizeCustomerCity(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null) return value;

  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}
