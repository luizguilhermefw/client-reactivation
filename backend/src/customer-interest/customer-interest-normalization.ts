export const MAX_CUSTOMER_INTEREST_NAME_LENGTH = 100;

export class CustomerInterestNameValidationError extends Error {
  readonly name = 'CustomerInterestNameValidationError';

  constructor() {
    super('Interest option name is invalid');
  }
}

export interface NormalizedCustomerInterestName {
  name: string;
  normalizedName: string;
}

export function normalizeCustomerInterestName(
  value: string,
): NormalizedCustomerInterestName {
  if (typeof value !== 'string') {
    throw new CustomerInterestNameValidationError();
  }

  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > MAX_CUSTOMER_INTEREST_NAME_LENGTH) {
    throw new CustomerInterestNameValidationError();
  }

  return { name, normalizedName: name.toLocaleLowerCase('pt-BR') };
}
