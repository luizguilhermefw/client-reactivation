import { cpf } from 'cpf-cnpj-validator';

const CPF_DIGITS_PATTERN = /^\d{11}$/;
const CPF_INPUT_PATTERN = /^[\d.\-\s]+$/;

export class CustomerCpfValidationError extends Error {
  readonly name = 'CustomerCpfValidationError';

  constructor() {
    super('CPF inválido');
  }
}

export function normalizeCpf(value: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    !CPF_INPUT_PATTERN.test(value)
  ) {
    throw new CustomerCpfValidationError();
  }

  const normalized = value.replace(/[.\-\s]/g, '');

  if (!CPF_DIGITS_PATTERN.test(normalized)) {
    throw new CustomerCpfValidationError();
  }

  return normalized;
}

export function assertValidCpf(value: string): string {
  const normalized = normalizeCpf(value);

  if (!cpf.isValid(normalized, true)) {
    throw new CustomerCpfValidationError();
  }

  return normalized;
}
