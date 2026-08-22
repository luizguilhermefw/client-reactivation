import { IsInt, Min } from 'class-validator';

export class SetWhatsappChannelsLimitDto {
  @IsInt()
  @Min(0)
  limit: number;
}
