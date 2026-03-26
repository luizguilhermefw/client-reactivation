import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty({ message: 'O nome não pode estar vazio.' })
  name: string;

  @IsEmail({}, { message: 'Forneça um endereço de e-mail válido.' })
  @IsNotEmpty({ message: 'O e-mail não pode estar vazio.' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter pelo menos 6 caracteres.' })
  @IsNotEmpty({ message: 'A senha não pode estar vazia.' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'O ID da empresa não pode estar vazio.' })
  companyId: string;
}