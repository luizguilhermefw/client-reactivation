import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Forneça um endereço de e-mail válido.' })
  @IsNotEmpty({ message: 'O e-mail não pode estar vazio.' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter pelo menos 6 caracteres.' })
  @IsNotEmpty({ message: 'A senha não pode estar vazia.' })
  password: string;
}