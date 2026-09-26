import {
  IsDateString,
  IsEnum,
  IsIn,
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

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  preferredName?: string | null;

  @IsOptional()
  @IsString()
  phone?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  cpf?: string | null;

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
