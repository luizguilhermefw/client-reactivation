import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDefined,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsString,
  MaxLength,
  Matches,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { CampaignAudienceType } from '@prisma/client';
import {
  MAX_CAMPAIGN_USER_CAPTION_LENGTH,
  MAX_CAMPAIGN_USER_TEXT_LENGTH,
} from '../campaign/campaign-message';
import { MAX_CAMPAIGN_CUSTOMER_IDS } from '../campaign/campaign-segmentation';

export { MAX_CAMPAIGN_CUSTOMER_IDS } from '../campaign/campaign-segmentation';

export enum CampaignDispatchType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
}

export { CampaignAudienceType } from '@prisma/client';

@ValidatorConstraint({ name: 'campaignAudience', async: false })
class CampaignAudienceConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const audience = args.object as CampaignAudienceDto;

    if (audience.type === CampaignAudienceType.ALL_ELIGIBLE) {
      return audience.customerIds === undefined;
    }

    if (audience.type === CampaignAudienceType.SEGMENTED) {
      return audience.customerIds === undefined;
    }

    if (audience.type === CampaignAudienceType.CUSTOMER_IDS) {
      return (
        Array.isArray(audience.customerIds) && audience.customerIds.length > 0
      );
    }

    return true;
  }

  defaultMessage(): string {
    return 'audience não corresponde ao tipo informado';
  }
}

export class CampaignAudienceDto {
  @IsEnum(CampaignAudienceType)
  @Validate(CampaignAudienceConstraint)
  type: CampaignAudienceType;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_CAMPAIGN_CUSTOMER_IDS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Matches(/\S/, {
    each: true,
    message: 'customerIds não pode conter IDs vazios',
  })
  customerIds?: string[];
}

@ValidatorConstraint({ name: 'campaignDispatchPayload', async: false })
class CampaignDispatchPayloadConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const input = args.object as DispatchCampaignDto;

    if (input.type === CampaignDispatchType.TEXT) {
      return (
        typeof input.content === 'string' &&
        input.content.trim().length > 0 &&
        input.mediaAssetId === undefined &&
        input.caption === undefined
      );
    }

    if (input.type === CampaignDispatchType.IMAGE) {
      return (
        typeof input.mediaAssetId === 'string' &&
        input.mediaAssetId.trim().length > 0 &&
        input.content === undefined
      );
    }

    return true;
  }

  defaultMessage(): string {
    return 'payload não corresponde ao tipo de campanha informado';
  }
}

export class DispatchCampaignDto {
  @IsEnum(CampaignDispatchType)
  @Validate(CampaignDispatchPayloadConstraint)
  type: CampaignDispatchType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CAMPAIGN_USER_TEXT_LENGTH)
  content?: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'mediaAssetId não pode ser vazio' })
  mediaAssetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CAMPAIGN_USER_CAPTION_LENGTH)
  caption?: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CampaignAudienceDto)
  audience: CampaignAudienceDto;
}

export interface DispatchCampaignResponse {
  automationId: string;
  type: CampaignDispatchType;
  audienceType: CampaignAudienceType;
  eligibleCustomers: number;
  processed: number;
}
