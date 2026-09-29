import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { CustomerGender } from '@prisma/client';
import {
  BRAZILIAN_STATE_CODES,
  normalizeBrazilianState,
} from '../../customer/customer-state';

export const MAX_PUBLIC_REGISTRATION_INTERESTS = 100;

export class PublicCustomerRegistrationDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  preferredName?: string | null;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  cpf: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

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

  @IsBoolean()
  contactConsent: boolean;

  @IsArray()
  @ArrayMaxSize(MAX_PUBLIC_REGISTRATION_INTERESTS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  interestOptionIds: string[];
}
