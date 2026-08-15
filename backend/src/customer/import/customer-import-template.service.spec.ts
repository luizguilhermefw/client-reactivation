import ExcelJS from 'exceljs';
import { CustomerImportTemplateService } from './customer-import-template.service';

describe('CustomerImportTemplateService', () => {
  it('creates the official two-sheet XLSX without real customer data', async () => {
    const content = await new CustomerImportTemplateService().create();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as never);

    expect(workbook.worksheets.map(({ name }) => name)).toEqual([
      'Clientes',
      'Instruções',
    ]);
    expect(workbook.worksheets[0].getRow(1).values).toEqual([
      ,
      'nome',
      'telefone',
      'dataNascimento',
      'ultimaCompra',
      'genero',
      'cidade',
      'uf',
      'contactConsent',
    ]);
    expect(workbook.worksheets[1].getCell('A9').text).toBe('contactConsent');
    expect(workbook.worksheets[1].getCell('B9').text).toContain('exemplo: SIM');
    expect(workbook.worksheets[1].getCell('B9').text).toContain('OPT_OUT');
  });
});
