import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { CustomerGender } from '@prisma/client';
import {
  BRAZILIAN_STATE_CODES,
  normalizeBrazilianState,
} from '../customer-state';

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  cpf?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsDateString()
  lastPurchaseDate?: string | null;

  @IsOptional()
  @IsEnum(CustomerGender)
  gender?: CustomerGender;

  @IsOptional()
  @IsString()
  city?: string | null;

  @Transform(({ value }) => normalizeBrazilianState(value))
  @IsOptional()
  @IsString()
  @IsIn(BRAZILIAN_STATE_CODES)
  state?: string | null;
}
