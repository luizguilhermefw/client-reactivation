const CUSTOMER_REGISTRATION_PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidCustomerRegistrationPublicId(value: string): boolean {
  return CUSTOMER_REGISTRATION_PUBLIC_ID_PATTERN.test(value);
}
