import {
  IsDateString,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CampaignAudienceType, CustomerGender } from '@prisma/client';
import { normalizeCustomerCity } from '../../customer/customer-normalization';
import {
  BRAZILIAN_STATE_CODES,
  normalizeBrazilianState,
} from '../../customer/customer-state';

export class UpdateAutomationDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  daysAfter?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  cooldownHours?: number;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  message?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(CampaignAudienceType)
  audienceType?: CampaignAudienceType;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsEnum(CustomerGender)
  segmentGender?: CustomerGender | null;

  @Transform(({ value }) => normalizeCustomerCity(value))
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  segmentCity?: string | null;

  @Transform(({ value }) => normalizeBrazilianState(value))
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @IsIn(BRAZILIAN_STATE_CODES)
  segmentState?: string | null;

  @Type(() => Number)
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(120)
  segmentMinAge?: number | null;

  @Type(() => Number)
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(120)
  segmentMaxAge?: number | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsDateString()
  segmentLastPurchaseBefore?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsDateString()
  segmentLastPurchaseAfter?: string | null;
}
