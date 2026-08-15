import { CustomerContactConsentStatus, CustomerGender } from '@prisma/client';

export const MAX_CUSTOMER_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_CUSTOMER_IMPORT_ROWS = 5_000;

export type CustomerImportField =
  | 'name'
  | 'phone'
  | 'birthDate'
  | 'lastPurchaseDate'
  | 'gender'
  | 'city'
  | 'state'
  | 'contactConsent';

export type CustomerImportRowStatus =
  | 'NEW'
  | 'EXISTING'
  | 'INVALID'
  | 'DUPLICATE_IN_FILE';

export interface CustomerImportFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface ParsedCustomerImportRow {
  rowNumber: number;
  values: Partial<Record<CustomerImportField, unknown>>;
}

export interface ParsedCustomerImport {
  ignoredHeaders: string[];
  rows: ParsedCustomerImportRow[];
}

export interface NormalizedCustomerImportData {
  name: string;
  phone: string;
  birthDate: string | null;
  lastPurchaseDate: string | null;
  gender: CustomerGender;
  city: string | null;
  state: string | null;
  contactConsentStatus: CustomerContactConsentStatus;
}

export interface CustomerImportRowError {
  field: CustomerImportField;
  code: string;
  message: string;
}

export interface NormalizedCustomerImportRow {
  rowNumber: number;
  data: NormalizedCustomerImportData;
  errors: CustomerImportRowError[];
}

export interface CustomerImportPreviewRow extends NormalizedCustomerImportRow {
  status: CustomerImportRowStatus;
}

export interface CustomerImportPreview {
  summary: {
    totalRows: number;
    new: number;
    existing: number;
    invalid: number;
    duplicateInFile: number;
  };
  ignoredHeaders: string[];
  rows: CustomerImportPreviewRow[];
}

export interface CustomerImportExecuteResult {
  summary: {
    totalRows: number;
    imported: number;
    existing: number;
    invalid: number;
    duplicateInFile: number;
  };
  rows: CustomerImportPreviewRow[];
}
