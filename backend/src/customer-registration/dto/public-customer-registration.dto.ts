import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  MaxLength,
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
export const PUBLIC_REGISTRATION_FIELD_LIMITS = {
  name: 120,
  preferredName: 120,
  phone: 30,
  cpf: 20,
  city: 100,
} as const;

export class PublicCustomerRegistrationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PUBLIC_REGISTRATION_FIELD_LIMITS.name)
  name: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(PUBLIC_REGISTRATION_FIELD_LIMITS.preferredName)
  preferredName?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PUBLIC_REGISTRATION_FIELD_LIMITS.phone)
  phone: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PUBLIC_REGISTRATION_FIELD_LIMITS.cpf)
  cpf: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsEnum(CustomerGender)
  gender?: CustomerGender;

  @IsOptional()
  @IsString()
  @MaxLength(PUBLIC_REGISTRATION_FIELD_LIMITS.city)
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
