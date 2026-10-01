import { Transform, Type } from 'class-transformer';
import { CampaignAudienceType, CustomerGender } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
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

@ValidatorConstraint({
  name: 'updateCampaignInterestFilterLimit',
  async: false,
})
class UpdateCampaignInterestFilterLimitConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const input = args.object as UpdateAutomationDto;
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

export class UpdateAutomationDto {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID()
  messagingChannelId?: string | null;

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

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @Validate(UpdateCampaignInterestFilterLimitConstraint)
  segmentCategoryIds?: string[] | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @Validate(UpdateCampaignInterestFilterLimitConstraint)
  segmentBrandIds?: string[] | null;
}
