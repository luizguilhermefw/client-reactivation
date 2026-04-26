import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  @MinLength(2, { message: 'Nome deve ter no mínimo 2 caracteres' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'CNPJ é obrigatório' })
  @Matches(/^[A-Z0-9]{14}$/i, {
  message: 'CNPJ deve conter 14 caracteres alfanuméricos',
  })
  cnpj: string;
}