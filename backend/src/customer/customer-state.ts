export const BRAZILIAN_STATE_CODES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

export type BrazilianStateCode = (typeof BRAZILIAN_STATE_CODES)[number];

const BRAZILIAN_STATE_CODE_SET = new Set<string>(BRAZILIAN_STATE_CODES);

export function normalizeBrazilianState(
  value: string | null | undefined,
): string | null | undefined;
export function normalizeBrazilianState(value: unknown): unknown;
export function normalizeBrazilianState(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

export function isBrazilianStateCode(
  value: string,
): value is BrazilianStateCode {
  return BRAZILIAN_STATE_CODE_SET.has(value);
}
