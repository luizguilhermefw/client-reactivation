import { Transform, Type } from 'class-transformer';
import { CampaignAudienceType, CustomerGender } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidateIf,
} from 'class-validator';
import { MAX_CAMPAIGN_INTEREST_FILTERS } from '../campaign/campaign-segmentation';
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
  'segmentCategoryIds',
  'segmentBrandIds',
] as const;

@ValidatorConstraint({ name: 'createCampaignConfiguration', async: false })
class CreateCampaignConfigurationConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const input = args.object as CreateCampaignDto;
    const audienceType =
      input.audienceType ?? CampaignAudienceType.ALL_ELIGIBLE;
    const hasSuppliedFilter = SEGMENT_FILTER_KEYS.some(
      (key) => input[key] !== undefined,
    );
    const hasFilter = SEGMENT_FILTER_KEYS.some((key) => {
      const value = input[key];
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    });

    return audienceType === CampaignAudienceType.SEGMENTED
      ? hasFilter
      : !hasSuppliedFilter &&
          audienceType !== CampaignAudienceType.CUSTOMER_IDS;
  }

  defaultMessage(): string {
    return 'campaign audience configuration is invalid';
  }
}

@ValidatorConstraint({ name: 'campaignInterestFilterLimit', async: false })
class CampaignInterestFilterLimitConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const input = args.object as CreateCampaignDto;
    return (
      (input.segmentCategoryIds?.length ?? 0) +
        (input.segmentBrandIds?.length ?? 0) <=
      MAX_CAMPAIGN_INTEREST_FILTERS
    );
  }

  defaultMessage(): string {
    return 'Campaign interest filter limit exceeded';
  }
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'name não pode ser vazio' })
  @MaxLength(MAX_CAMPAIGN_NAME_LENGTH)
  @Validate(CreateCampaignConfigurationConstraint)
  @Validate(CampaignInterestFilterLimitConstraint)
  name: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  messagingChannelId?: string;

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

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  segmentCategoryIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  segmentBrandIds?: string[];
}
