import { CustomerContactConsentStatus, CustomerGender } from '@prisma/client';
import {
  isValidCustomerPhone,
  normalizeCustomerCity,
  normalizeCustomerPhone,
} from '../customer-normalization';
import {
  isBrazilianStateCode,
  normalizeBrazilianState,
} from '../customer-state';
import {
  CustomerImportField,
  CustomerImportRowError,
  NormalizedCustomerImportRow,
  ParsedCustomerImportRow,
} from './customer-import.types';

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizedAlias(value: unknown): string {
  return asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function normalizeGender(value: unknown): CustomerGender | null {
  const alias = normalizedAlias(value);
  if (!alias || alias === 'NAO INFORMADO' || alias === 'UNSPECIFIED') {
    return CustomerGender.UNSPECIFIED;
  }
  if (['F', 'FEMININO', 'FEMALE'].includes(alias)) {
    return CustomerGender.FEMALE;
  }
  if (['M', 'MASCULINO', 'MALE'].includes(alias)) {
    return CustomerGender.MALE;
  }
  if (['OUTRO', 'OUTROS', 'OTHER'].includes(alias)) {
    return CustomerGender.OTHER;
  }
  return null;
}

function normalizeContactConsent(
  value: unknown,
): CustomerContactConsentStatus | null {
  const alias = normalizedAlias(value);

  if (['SIM', 'S', 'TRUE', '1', 'X'].includes(alias)) {
    return CustomerContactConsentStatus.GRANTED;
  }

  if (!alias || ['NAO', 'N', 'FALSE', '0'].includes(alias)) {
    return CustomerContactConsentStatus.UNKNOWN;
  }

  if (['OPT_OUT', 'OPTOUT', 'BLOQUEADO'].includes(alias)) {
    return CustomerContactConsentStatus.OPTED_OUT;
  }

  return null;
}

function dateParts(value: unknown): [number, number, number] | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return [
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    ];
  }

  const text = asText(value);
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (brazilian) {
    return [Number(brazilian[3]), Number(brazilian[2]), Number(brazilian[1])];
  }
  return [Number.NaN, Number.NaN, Number.NaN];
}

function normalizeDate(value: unknown, today: Date): string | null | false {
  if (value === null || value === undefined || asText(value) === '')
    return null;
  const parts = dateParts(value);
  if (!parts) return null;

  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return false;
  }

  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  if (date.getTime() > todayUtc) return false;
  return date.toISOString().slice(0, 10);
}

function addError(
  errors: CustomerImportRowError[],
  field: CustomerImportField,
  code: string,
  message: string,
): void {
  errors.push({ field, code, message });
}

export function normalizeCustomerImportRow(
  row: ParsedCustomerImportRow,
  today = new Date(),
): NormalizedCustomerImportRow {
  const errors: CustomerImportRowError[] = [];
  const name = asText(row.values.name).replace(/\s+/g, ' ');
  if (!name) addError(errors, 'name', 'REQUIRED_NAME', 'Nome obrigatório');

  const phone = normalizeCustomerPhone(asText(row.values.phone));
  if (!phone) {
    addError(errors, 'phone', 'REQUIRED_PHONE', 'Telefone obrigatório');
  } else if (!isValidCustomerPhone(phone)) {
    addError(errors, 'phone', 'INVALID_PHONE', 'Telefone inválido');
  }

  const gender = normalizeGender(row.values.gender);
  if (!gender) {
    addError(errors, 'gender', 'INVALID_GENDER', 'Gênero inválido');
  }

  const contactConsentStatus = normalizeContactConsent(
    row.values.contactConsent,
  );
  if (!contactConsentStatus) {
    addError(
      errors,
      'contactConsent',
      'INVALID_CONTACT_CONSENT',
      'Consentimento de contato inválido',
    );
  }

  const city = normalizeCustomerCity(asText(row.values.city)) ?? null;
  const normalizedState = normalizeBrazilianState(asText(row.values.state));
  const state = normalizedState || null;
  if (state && !isBrazilianStateCode(state)) {
    addError(errors, 'state', 'INVALID_STATE', 'UF inválida');
  }

  const birthDate = normalizeDate(row.values.birthDate, today);
  if (birthDate === false) {
    addError(
      errors,
      'birthDate',
      'INVALID_BIRTH_DATE',
      'Data de nascimento inválida',
    );
  }
  const lastPurchaseDate = normalizeDate(row.values.lastPurchaseDate, today);
  if (lastPurchaseDate === false) {
    addError(
      errors,
      'lastPurchaseDate',
      'INVALID_LAST_PURCHASE_DATE',
      'Data da última compra inválida',
    );
  }

  return {
    rowNumber: row.rowNumber,
    data: {
      name,
      phone,
      birthDate: birthDate === false ? null : birthDate,
      lastPurchaseDate: lastPurchaseDate === false ? null : lastPurchaseDate,
      gender: gender ?? CustomerGender.UNSPECIFIED,
      city,
      state: state && isBrazilianStateCode(state) ? state : null,
      contactConsentStatus:
        contactConsentStatus ?? CustomerContactConsentStatus.UNKNOWN,
    },
    errors,
  };
}
