import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { CampaignAudienceDto } from './dispatch-campaign.dto';

export class PreviewCampaignAudienceDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CampaignAudienceDto)
  audience?: CampaignAudienceDto;
}
