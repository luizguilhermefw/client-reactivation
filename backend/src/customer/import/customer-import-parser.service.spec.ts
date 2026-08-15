import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { CustomerImportParserService } from './customer-import-parser.service';
import { CustomerImportFile } from './customer-import.types';

describe('CustomerImportParserService', () => {
  const service = new CustomerImportParserService();
  const csvFile = (
    content: string,
    name = 'customers.csv',
  ): CustomerImportFile => {
    const buffer = Buffer.from(content, 'utf8');
    return {
      originalname: name,
      mimetype: 'text/csv',
      size: buffer.length,
      buffer,
    };
  };
  const xlsxFile = async (
    configure: (workbook: ExcelJS.Workbook) => void,
  ): Promise<CustomerImportFile> => {
    const workbook = new ExcelJS.Workbook();
    configure(workbook);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      originalname: 'customers.xlsx',
      mimetype:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: buffer.length,
      buffer,
    };
  };

  it('parses valid CSV with case-insensitive Portuguese aliases and ignored headers', async () => {
    const result = await service.parse(
      csvFile(
        ' NOME ,CELULAR,data_nascimento,CONTACTCONSENT,Observacao,companyId,contactConsentStatus,consentGrantedAt,optedOutAt\nAna,45999999999,01/02/1990,sim,x,attacker,GRANTED,2026-01-01,2026-01-02',
      ),
    );

    expect(result.ignoredHeaders).toEqual([
      'Observacao',
      'companyId',
      'contactConsentStatus',
      'consentGrantedAt',
      'optedOutAt',
    ]);
    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        values: {
          name: 'Ana',
          phone: '45999999999',
          birthDate: '01/02/1990',
          contactConsent: 'sim',
        },
      },
    ]);
  });

  it('parses contactConsent from XLSX while keeping the field optional', async () => {
    const file = await xlsxFile((workbook) => {
      const worksheet = workbook.addWorksheet('Clientes');
      worksheet.addRow(['nome', 'telefone', 'contactConsent']);
      worksheet.addRow(['Ana', '45999999999', true]);
      worksheet.addRow(['Bia', '45888888888']);
    });

    const result = await service.parse(file);

    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        values: {
          name: 'Ana',
          phone: '45999999999',
          contactConsent: true,
        },
      },
      {
        rowNumber: 3,
        values: {
          name: 'Bia',
          phone: '45888888888',
          contactConsent: null,
        },
      },
    ]);
  });

  it('uses only the first XLSX worksheet and preserves Date values', async () => {
    const file = await xlsxFile((workbook) => {
      const first = workbook.addWorksheet('Clientes');
      first.addRow(['nome', 'telefone', 'dataNascimento']);
      first.addRow(['Ana', '45999999999', new Date('1990-01-02T00:00:00Z')]);
      const ignored = workbook.addWorksheet('Instruções');
      ignored.addRow(['nome', 'telefone']);
      ignored.addRow(['Não importar', '000']);
    });

    const result = await service.parse(file);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].values.birthDate).toBeInstanceOf(Date);
  });

  it.each([
    [csvFile('', 'empty.csv'), 'empty file'],
    [csvFile('Ana,45999999999'), 'missing required headers'],
    [csvFile('nome,telefone,celular\nAna,1,2'), 'ambiguous header'],
    [csvFile('nome,telefone\nAna,1', 'customers.txt'), 'invalid extension'],
    [
      {
        ...csvFile('not an xlsx'),
        originalname: 'customers.xlsx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      'corrupted parser input',
    ],
  ])('rejects %s (%s)', async (file) => {
    await expect(service.parse(file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects more than 5000 data rows', async () => {
    const rows = Array.from(
      { length: 5001 },
      (_, index) => `Name ${index},45${index}`,
    );
    await expect(
      service.parse(csvFile(['nome,telefone', ...rows].join('\n'))),
    ).rejects.toThrow('Customer import exceeds 5000 data rows');
  });

  it('rejects a file larger than 5 MB before parsing', async () => {
    const buffer = Buffer.alloc(5 * 1024 * 1024 + 1, 1);

    await expect(
      service.parse({
        originalname: 'customers.csv',
        mimetype: 'text/csv',
        size: buffer.length,
        buffer,
      }),
    ).rejects.toThrow('Customer import file exceeds 5 MB');
  });

  it.each(['text/plain', 'application/vnd.ms-excel'])(
    'accepts CSV with common MIME %s',
    async (mimetype) => {
      const file = csvFile('nome,telefone\nAna,45999999999');
      await expect(service.parse({ ...file, mimetype })).resolves.toEqual(
        expect.objectContaining({ rows: expect.any(Array) }),
      );
    },
  );

  it.each([
    ['customers.txt', 'text/plain'],
    ['customers.xls', 'application/vnd.ms-excel'],
  ])(
    'rejects extension %s even with MIME %s',
    async (originalname, mimetype) => {
      const file = csvFile('nome,telefone\nAna,45999999999');
      await expect(
        service.parse({ ...file, originalname, mimetype }),
      ).rejects.toThrow('Only XLSX and CSV files are allowed');
    },
  );
});
