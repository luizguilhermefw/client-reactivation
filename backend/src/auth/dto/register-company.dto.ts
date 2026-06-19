import { IsEmail, IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

export class RegisterCompanyDto {
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{14}$/, { message: 'CNPJ deve conter 14 números' })
  cnpj: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(6, { message: 'Senha deve ter no mínimo 6 caracteres' })
  password: string;
}