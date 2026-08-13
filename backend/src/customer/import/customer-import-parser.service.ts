import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { isSupportedCustomerImportFileType } from './customer-import-file-policy';
import {
  CustomerImportField,
  CustomerImportFile,
  MAX_CUSTOMER_IMPORT_BYTES,
  MAX_CUSTOMER_IMPORT_ROWS,
  ParsedCustomerImport,
  ParsedCustomerImportRow,
} from './customer-import.types';

type ExcelJsBuffer = Parameters<ExcelJS.Workbook['xlsx']['load']>[0];

const HEADER_ALIASES: Record<string, CustomerImportField> = {
  name: 'name',
  nome: 'name',
  phone: 'phone',
  telefone: 'phone',
  celular: 'phone',
  whatsapp: 'phone',
  birthdate: 'birthDate',
  datanascimento: 'birthDate',
  nascimento: 'birthDate',
  lastpurchasedate: 'lastPurchaseDate',
  ultimacompra: 'lastPurchaseDate',
  dataultimacompra: 'lastPurchaseDate',
  gender: 'gender',
  genero: 'gender',
  sexo: 'gender',
  city: 'city',
  cidade: 'city',
  state: 'state',
  uf: 'state',
  estado: 'state',
};

function normalizedHeader(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '')
    .toLowerCase();
}

function isEmptyCell(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function extractCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value instanceof Date || value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'object') return value;
  if ('result' in value && value.result !== undefined) return value.result;
  if ('richText' in value) {
    return value.richText.map(({ text }) => text).join('');
  }
  if ('text' in value && typeof value.text === 'string') return value.text;
  return cell.text;
}

@Injectable()
export class CustomerImportParserService {
  async parse(file: CustomerImportFile): Promise<ParsedCustomerImport> {
    this.assertSupportedFile(file);

    try {
      const workbook = new ExcelJS.Workbook();
      const extension = extname(file.originalname).toLowerCase();

      if (extension === '.xlsx') {
        await workbook.xlsx.load(file.buffer as unknown as ExcelJsBuffer);
      } else {
        await workbook.csv.read(Readable.from(file.buffer), {
          map: (value: unknown) => value,
        });
      }

      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new Error('missing worksheet');

      return this.parseWorksheet(worksheet);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Customer import file could not be parsed');
    }
  }

  private assertSupportedFile(file: CustomerImportFile): void {
    if (
      !file ||
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.length === 0 ||
      file.size <= 0 ||
      file.size !== file.buffer.length
    ) {
      throw new BadRequestException('Customer import file is empty or invalid');
    }
    if (file.size > MAX_CUSTOMER_IMPORT_BYTES) {
      throw new BadRequestException('Customer import file exceeds 5 MB');
    }

    if (!isSupportedCustomerImportFileType(file.originalname, file.mimetype)) {
      throw new BadRequestException('Only XLSX and CSV files are allowed');
    }
  }

  private parseWorksheet(worksheet: ExcelJS.Worksheet): ParsedCustomerImport {
    const headerRow = worksheet.getRow(1);
    const headerCount = headerRow.cellCount;
    if (headerCount === 0) {
      throw new BadRequestException('Customer import header is required');
    }

    const columns = new Map<number, CustomerImportField>();
    const recognizedFields = new Set<CustomerImportField>();
    const ignoredHeaders: string[] = [];

    for (let column = 1; column <= headerCount; column += 1) {
      const original = String(
        extractCellValue(headerRow.getCell(column)) ?? '',
      ).trim();
      if (!original) continue;

      const field = HEADER_ALIASES[normalizedHeader(original)];
      if (!field) {
        ignoredHeaders.push(original);
        continue;
      }
      if (recognizedFields.has(field)) {
        throw new BadRequestException('Customer import header is ambiguous');
      }
      recognizedFields.add(field);
      columns.set(column, field);
    }

    if (!recognizedFields.has('name') || !recognizedFields.has('phone')) {
      throw new BadRequestException('Customer import requires name and phone');
    }

    const rows: ParsedCustomerImportRow[] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const hasData = Array.from({ length: headerCount }, (_, index) =>
        extractCellValue(row.getCell(index + 1)),
      ).some((value) => !isEmptyCell(value));
      if (!hasData) continue;

      if (rows.length >= MAX_CUSTOMER_IMPORT_ROWS) {
        throw new BadRequestException('Customer import exceeds 5000 data rows');
      }

      const values: Partial<Record<CustomerImportField, unknown>> = {};
      for (const [column, field] of columns) {
        values[field] = extractCellValue(row.getCell(column));
      }
      rows.push({ rowNumber, values });
    }

    return { ignoredHeaders, rows };
  }
}
