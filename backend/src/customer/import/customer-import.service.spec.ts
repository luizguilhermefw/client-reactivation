import {
  CustomerContactConsentStatus,
  CustomerGender,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CustomerImportParserService } from './customer-import-parser.service';
import { CustomerImportService } from './customer-import.service';
import {
  CustomerImportFile,
  ParsedCustomerImport,
} from './customer-import.types';

describe('CustomerImportService', () => {
  const companyId = 'company-from-jwt';
  const file: CustomerImportFile = {
    originalname: 'customers.csv',
    mimetype: 'text/csv',
    size: 1,
    buffer: Buffer.from('x'),
  };
  const parsed: ParsedCustomerImport = {
    ignoredHeaders: ['companyId'],
    rows: [
      { rowNumber: 2, values: { name: 'New', phone: '(45) 9999-9999' } },
      { rowNumber: 3, values: { name: 'Existing', phone: '45988888888' } },
      { rowNumber: 4, values: { name: '', phone: '45977777777' } },
      { rowNumber: 5, values: { name: 'Duplicate', phone: '5545999999999' } },
    ],
  };
  const parserMock = { parse: jest.fn() };
  const transactionMock = {
    customer: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const prismaMock = {
    customer: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: CustomerImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    parserMock.parse.mockResolvedValue(parsed);
    prismaMock.customer.findMany.mockResolvedValue([
      { phone: '5545988888888' },
    ]);
    transactionMock.customer.findMany.mockResolvedValue([
      { phone: '5545988888888' },
    ]);
    transactionMock.customer.create.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(
      async (
        callback: (transaction: typeof transactionMock) => Promise<unknown>,
      ) => callback(transactionMock),
    );
    service = new CustomerImportService(
      prismaMock as unknown as PrismaService,
      parserMock as unknown as CustomerImportParserService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('classifies NEW, EXISTING, INVALID and normalized DUPLICATE_IN_FILE', async () => {
    const result = await service.preview(companyId, file);

    expect(result.summary).toEqual({
      totalRows: 4,
      new: 1,
      existing: 1,
      invalid: 1,
      duplicateInFile: 1,
    });
    expect(result.rows.map(({ status }) => status)).toEqual([
      'NEW',
      'EXISTING',
      'INVALID',
      'DUPLICATE_IN_FILE',
    ]);
    expect(result.ignoredHeaders).toEqual(['companyId']);
    expect(result.rows[1]).not.toHaveProperty('customerId');
  });

  it('looks up all valid unique phones once and always scopes by companyId', async () => {
    await service.preview(companyId, file);

    expect(prismaMock.customer.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
      where: {
        companyId,
        phone: {
          in: [
            '5545999999999',
            '554599999999',
            '5545988888888',
            '554588888888',
          ],
        },
      },
      select: { phone: true },
    });
  });

  it('classifies mobile forms with and without the ninth digit as duplicates', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);
    parserMock.parse.mockResolvedValue({
      ignoredHeaders: [],
      rows: [
        { rowNumber: 2, values: { name: 'First', phone: '45 9902-9181' } },
        {
          rowNumber: 3,
          values: { name: 'Second', phone: '45 9 9902-9181' },
        },
      ],
    });

    const result = await service.preview(companyId, file);

    expect(result.rows.map(({ status }) => status)).toEqual([
      'NEW',
      'DUPLICATE_IN_FILE',
    ]);
    expect(result.rows.map(({ data }) => data.phone)).toEqual([
      '5545999029181',
      '5545999029181',
    ]);
  });

  it('classifies a canonical mobile as EXISTING when the database has its legacy variant', async () => {
    parserMock.parse.mockResolvedValue({
      ignoredHeaders: [],
      rows: [
        {
          rowNumber: 2,
          values: { name: 'Existing', phone: '5545999029181' },
        },
      ],
    });
    prismaMock.customer.findMany.mockResolvedValue([{ phone: '554599029181' }]);

    const result = await service.preview(companyId, file);

    expect(result.rows[0].status).toBe('EXISTING');
    expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
      where: {
        companyId,
        phone: { in: ['5545999029181', '554599029181'] },
      },
      select: { phone: true },
    });
  });

  it('does not import a canonical mobile when execution finds its legacy variant', async () => {
    parserMock.parse.mockResolvedValue({
      ignoredHeaders: [],
      rows: [
        {
          rowNumber: 2,
          values: { name: 'Existing', phone: '45 9 9902-9181' },
        },
      ],
    });
    transactionMock.customer.findMany.mockResolvedValue([
      { phone: '554599029181' },
    ]);

    const result = await service.execute(companyId, file);

    expect(result.summary).toEqual({
      totalRows: 1,
      imported: 0,
      existing: 1,
      invalid: 0,
      duplicateInFile: 0,
    });
    expect(transactionMock.customer.create).not.toHaveBeenCalled();
  });

  it('does not treat a same-phone Customer from another tenant as EXISTING', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    const result = await service.preview(companyId, file);

    expect(result.rows[0].status).toBe('NEW');
    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId }),
      }),
    );
  });

  it('executes only NEW rows atomically with JWT tenant and safe defaults', async () => {
    const result = await service.execute(companyId, file);

    expect(parserMock.parse).toHaveBeenCalledTimes(1);
    expect(transactionMock.customer.create).toHaveBeenCalledTimes(1);
    expect(transactionMock.customer.create).toHaveBeenCalledWith({
      data: {
        companyId,
        name: 'New',
        phone: '5545999999999',
        gender: CustomerGender.UNSPECIFIED,
        city: null,
        state: null,
        birthDate: null,
        lastPurchaseDate: null,
        contactConsentStatus: CustomerContactConsentStatus.UNKNOWN,
        consentGrantedAt: null,
        optedOutAt: null,
        isActiveForAutomation: true,
      },
    });
    expect(result.summary).toEqual({
      totalRows: 4,
      imported: 1,
      existing: 1,
      invalid: 1,
      duplicateInFile: 1,
    });
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('creates NEW Customers with server-side consent timestamps for every status', async () => {
    const importedAt = new Date('2026-08-15T15:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(importedAt);
    parserMock.parse.mockResolvedValue({
      ignoredHeaders: [],
      rows: [
        {
          rowNumber: 2,
          values: {
            name: 'Granted',
            phone: '45999999999',
            contactConsent: 'SIM',
          },
        },
        {
          rowNumber: 3,
          values: {
            name: 'Unknown',
            phone: '45988888888',
            contactConsent: 'NÃO',
          },
        },
        {
          rowNumber: 4,
          values: {
            name: 'Opted out',
            phone: '45977777777',
            contactConsent: 'OPT_OUT',
          },
        },
      ],
    });
    transactionMock.customer.findMany.mockResolvedValue([]);

    const result = await service.execute(companyId, file);

    expect(result.summary.imported).toBe(3);
    expect(
      transactionMock.customer.create.mock.calls.map(([call]) => ({
        contactConsentStatus: call.data.contactConsentStatus,
        consentGrantedAt: call.data.consentGrantedAt,
        optedOutAt: call.data.optedOutAt,
      })),
    ).toEqual([
      {
        contactConsentStatus: CustomerContactConsentStatus.GRANTED,
        consentGrantedAt: importedAt,
        optedOutAt: null,
      },
      {
        contactConsentStatus: CustomerContactConsentStatus.UNKNOWN,
        consentGrantedAt: null,
        optedOutAt: null,
      },
      {
        contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
        consentGrantedAt: null,
        optedOutAt: importedAt,
      },
    ]);
  });

  it.each([
    ['OPTED_OUT', 'SIM', CustomerContactConsentStatus.GRANTED],
    ['GRANTED', 'NÃO', CustomerContactConsentStatus.UNKNOWN],
  ])(
    'does not overwrite an EXISTING %s Customer when the spreadsheet normalizes to %s',
    async (_existingStatus, contactConsent, normalizedStatus) => {
      parserMock.parse.mockResolvedValue({
        ignoredHeaders: [],
        rows: [
          {
            rowNumber: 2,
            values: {
              name: 'Existing',
              phone: '45999999999',
              contactConsent,
            },
          },
        ],
      });
      transactionMock.customer.findMany.mockResolvedValue([
        { phone: '5545999999999' },
      ]);

      const result = await service.execute(companyId, file);

      expect(result.rows[0]).toEqual(
        expect.objectContaining({
          status: 'EXISTING',
          data: expect.objectContaining({
            contactConsentStatus: normalizedStatus,
          }),
        }),
      );
      expect(transactionMock.customer.create).not.toHaveBeenCalled();
      expect(transactionMock.customer.update).not.toHaveBeenCalled();
    },
  );

  it('reparses and revalidates existing Customers between preview and execute', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);
    const preview = await service.preview(companyId, file);
    expect(preview.rows[0].status).toBe('NEW');
    transactionMock.customer.findMany.mockResolvedValue([
      { phone: '5545999999999' },
      { phone: '5545988888888' },
    ]);

    const execute = await service.execute(companyId, file);

    expect(parserMock.parse).toHaveBeenCalledTimes(2);
    expect(execute.summary.imported).toBe(0);
    expect(transactionMock.customer.create).not.toHaveBeenCalled();
  });

  it('uses the newly uploaded file instead of preview rows from the client', async () => {
    parserMock.parse.mockResolvedValueOnce(parsed).mockResolvedValueOnce({
      ignoredHeaders: [],
      rows: [
        { rowNumber: 2, values: { name: 'Changed', phone: '45966666666' } },
      ],
    });
    await service.preview(companyId, file);
    transactionMock.customer.findMany.mockResolvedValue([]);

    await service.execute(companyId, file);

    expect(transactionMock.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Changed',
        phone: '5545966666666',
      }),
    });
  });

  it('propagates an unexpected insert failure through the transaction', async () => {
    transactionMock.customer.findMany.mockResolvedValue([]);
    transactionMock.customer.create.mockRejectedValue(
      new Error('database failure'),
    );

    await expect(service.execute(companyId, file)).rejects.toThrow(
      'database failure',
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
