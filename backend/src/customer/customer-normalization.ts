export function normalizeCustomerPhone(phone: string): string {
  let normalized = phone.replace(/\D/g, '');

  if (normalized.length === 10 || normalized.length === 11) {
    normalized = `55${normalized}`;
  }

  return normalized;
}

export function isValidCustomerPhone(phone: string): boolean {
  return /^55\d{10,11}$/.test(phone);
}

export function normalizeCustomerCity(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null) return value;

  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}
