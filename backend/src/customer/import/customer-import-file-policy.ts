import { extname } from 'node:path';

export const CUSTOMER_IMPORT_MIME_TYPES_BY_EXTENSION = new Map<
  string,
  ReadonlySet<string>
>([
  [
    '.xlsx',
    new Set([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]),
  ],
  [
    '.csv',
    new Set([
      'text/csv',
      'application/csv',
      'text/plain',
      'application/vnd.ms-excel',
    ]),
  ],
]);

export function isSupportedCustomerImportFileType(
  originalName: string,
  mimeType: string,
): boolean {
  return Boolean(
    CUSTOMER_IMPORT_MIME_TYPES_BY_EXTENSION.get(
      extname(originalName).toLowerCase(),
    )?.has(mimeType),
  );
}
