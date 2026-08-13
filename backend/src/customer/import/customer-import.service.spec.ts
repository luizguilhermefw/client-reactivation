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
      { rowNumber: 2, values: { name: 'New', phone: '(45) 99999-9999' } },
      { rowNumber: 3, values: { name: 'Existing', phone: '45988888888' } },
      { rowNumber: 4, values: { name: '', phone: '45977777777' } },
      { rowNumber: 5, values: { name: 'Duplicate', phone: '5545999999999' } },
    ],
  };
  const parserMock = { parse: jest.fn() };
  const transactionMock = {
    customer: { findMany: jest.fn(), create: jest.fn() },
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
          in: ['5545999999999', '5545988888888'],
        },
      },
      select: { phone: true },
    });
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
