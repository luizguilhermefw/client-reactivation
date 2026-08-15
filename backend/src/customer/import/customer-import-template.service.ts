import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

@Injectable()
export class CustomerImportTemplateService {
  async create(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const customers = workbook.addWorksheet('Clientes');
    customers.addRow([
      'nome',
      'telefone',
      'dataNascimento',
      'ultimaCompra',
      'genero',
      'cidade',
      'uf',
      'contactConsent',
    ]);
    customers.getRow(1).font = { bold: true };

    const instructions = workbook.addWorksheet('Instruções');
    instructions.addRows([
      ['Campo', 'Orientação'],
      ['nome', 'obrigatório'],
      ['telefone', 'obrigatório'],
      ['dataNascimento', 'opcional, DD/MM/YYYY'],
      ['ultimaCompra', 'opcional, DD/MM/YYYY'],
      ['genero', 'FEMININO / MASCULINO / OUTRO / NÃO INFORMADO'],
      ['cidade', 'opcional'],
      ['uf', 'sigla brasileira, ex. PR'],
      [
        'contactConsent',
        'opcional; exemplo: SIM. Aceita SIM, S, TRUE, 1, X; NÃO/NAO, N, FALSE, 0 ou vazio; OPT_OUT, OPTOUT ou BLOQUEADO.',
      ],
    ]);
    instructions.getRow(1).font = { bold: true };
    instructions.columns = [{ width: 22 }, { width: 90 }];

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
