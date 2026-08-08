import { IsNotEmpty, IsString, MaxLength, Matches } from 'class-validator';

export const MAX_CAMPAIGN_NAME_LENGTH = 120;

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'name não pode ser vazio' })
  @MaxLength(MAX_CAMPAIGN_NAME_LENGTH)
  name: string;
}
