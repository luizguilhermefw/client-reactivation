import { Transform, Type } from 'class-transformer';
import { CampaignAudienceType, CustomerGender } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { normalizeCustomerCity } from '../../customer/customer-normalization';
import {
  BRAZILIAN_STATE_CODES,
  normalizeBrazilianState,
} from '../../customer/customer-state';

export const MAX_CAMPAIGN_NAME_LENGTH = 120;

const SEGMENT_FILTER_KEYS = [
  'segmentGender',
  'segmentCity',
  'segmentState',
  'segmentMinAge',
  'segmentMaxAge',
  'segmentLastPurchaseBefore',
  'segmentLastPurchaseAfter',
] as const;

@ValidatorConstraint({ name: 'createCampaignConfiguration', async: false })
class CreateCampaignConfigurationConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: unknown, args: ValidationArguments): boolean {
    const input = args.object as CreateCampaignDto;
    const audienceType =
      input.audienceType ?? CampaignAudienceType.ALL_ELIGIBLE;
    const hasFilter = SEGMENT_FILTER_KEYS.some((key) => {
      const value = input[key];
      return value !== undefined && value !== null && value !== '';
    });

    return audienceType === CampaignAudienceType.SEGMENTED
      ? hasFilter
      : !hasFilter && audienceType !== CampaignAudienceType.CUSTOMER_IDS;
  }

  defaultMessage(): string {
    return 'campaign audience configuration is invalid';
  }
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'name não pode ser vazio' })
  @MaxLength(MAX_CAMPAIGN_NAME_LENGTH)
  @Validate(CreateCampaignConfigurationConstraint)
  name: string;

  @IsOptional()
  @IsEnum(CampaignAudienceType)
  audienceType?: CampaignAudienceType;

  @IsOptional()
  @IsEnum(CustomerGender)
  segmentGender?: CustomerGender;

  @Transform(({ value }) => normalizeCustomerCity(value) ?? undefined)
  @IsOptional()
  @IsString()
  segmentCity?: string;

  @Transform(({ value }) => normalizeBrazilianState(value) ?? undefined)
  @IsOptional()
  @IsString()
  @IsIn(BRAZILIAN_STATE_CODES)
  segmentState?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  segmentMinAge?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  segmentMaxAge?: number;

  @IsOptional()
  @IsDateString()
  segmentLastPurchaseBefore?: string;

  @IsOptional()
  @IsDateString()
  segmentLastPurchaseAfter?: string;
}
