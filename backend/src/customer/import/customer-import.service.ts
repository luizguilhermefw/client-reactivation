import { Injectable } from '@nestjs/common';
import { CustomerContactConsentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  getCustomerPhoneIdentityVariants,
  normalizeCustomerPhone,
} from '../customer-normalization';
import { normalizeCustomerImportRow } from './customer-import-normalizer';
import { CustomerImportParserService } from './customer-import-parser.service';
import {
  CustomerImportExecuteResult,
  CustomerImportFile,
  CustomerImportPreview,
  CustomerImportPreviewRow,
  ParsedCustomerImport,
} from './customer-import.types';

interface CustomerLookupClient {
  customer: {
    findMany(args: {
      where: { companyId: string; phone: { in: string[] } };
      select: { phone: true };
    }): Promise<Array<{ phone: string }>>;
  };
}

@Injectable()
export class CustomerImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: CustomerImportParserService,
  ) {}

  async preview(
    companyId: string,
    file: CustomerImportFile,
  ): Promise<CustomerImportPreview> {
    const parsed = await this.parser.parse(file);
    return this.classify(companyId, parsed, this.prisma);
  }

  async execute(
    companyId: string,
    file: CustomerImportFile,
  ): Promise<CustomerImportExecuteResult> {
    const parsed = await this.parser.parse(file);

    return this.prisma.$transaction(
      async (transaction) => {
        const preview = await this.classify(companyId, parsed, transaction);
        const newRows = preview.rows.filter(({ status }) => status === 'NEW');
        const importedAt = new Date();

        for (const { data } of newRows) {
          await transaction.customer.create({
            data: {
              companyId,
              name: data.name,
              phone: data.phone,
              gender: data.gender,
              city: data.city,
              state: data.state,
              birthDate: data.birthDate
                ? new Date(`${data.birthDate}T00:00:00.000Z`)
                : null,
              lastPurchaseDate: data.lastPurchaseDate
                ? new Date(`${data.lastPurchaseDate}T00:00:00.000Z`)
                : null,
              contactConsentStatus: data.contactConsentStatus,
              consentGrantedAt:
                data.contactConsentStatus ===
                CustomerContactConsentStatus.GRANTED
                  ? importedAt
                  : null,
              optedOutAt:
                data.contactConsentStatus ===
                CustomerContactConsentStatus.OPTED_OUT
                  ? importedAt
                  : null,
              isActiveForAutomation: true,
            },
          });
        }

        return {
          summary: {
            totalRows: preview.summary.totalRows,
            imported: newRows.length,
            existing: preview.summary.existing,
            invalid: preview.summary.invalid,
            duplicateInFile: preview.summary.duplicateInFile,
          },
          rows: preview.rows,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async classify(
    companyId: string,
    parsed: ParsedCustomerImport,
    database: CustomerLookupClient,
  ): Promise<CustomerImportPreview> {
    const normalizedRows = parsed.rows.map((row) =>
      normalizeCustomerImportRow(row),
    );
    const validPhones = [
      ...new Set(
        normalizedRows
          .filter(({ errors }) => errors.length === 0)
          .map(({ data }) => data.phone),
      ),
    ];
    const existing = validPhones.length
      ? await database.customer.findMany({
          where: {
            companyId,
            phone: {
              in: [
                ...new Set(
                  validPhones.flatMap((phone) =>
                    getCustomerPhoneIdentityVariants(phone),
                  ),
                ),
              ],
            },
          },
          select: { phone: true },
        })
      : [];
    const existingPhones = new Set(
      existing.map(({ phone }) => normalizeCustomerPhone(phone)),
    );
    const seenPhones = new Set<string>();

    const rows: CustomerImportPreviewRow[] = normalizedRows.map((row) => {
      let status: CustomerImportPreviewRow['status'];
      if (row.errors.length > 0) {
        status = 'INVALID';
      } else if (seenPhones.has(row.data.phone)) {
        status = 'DUPLICATE_IN_FILE';
      } else if (existingPhones.has(row.data.phone)) {
        status = 'EXISTING';
      } else {
        status = 'NEW';
      }

      if (row.errors.length === 0) seenPhones.add(row.data.phone);
      return { ...row, status };
    });

    return {
      summary: {
        totalRows: rows.length,
        new: rows.filter(({ status }) => status === 'NEW').length,
        existing: rows.filter(({ status }) => status === 'EXISTING').length,
        invalid: rows.filter(({ status }) => status === 'INVALID').length,
        duplicateInFile: rows.filter(
          ({ status }) => status === 'DUPLICATE_IN_FILE',
        ).length,
      },
      ignoredHeaders: parsed.ignoredHeaders,
      rows,
    };
  }
}
