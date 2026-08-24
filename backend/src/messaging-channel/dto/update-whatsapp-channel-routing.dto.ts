import { IsBoolean } from 'class-validator';

export class UpdateWhatsappChannelRoutingDto {
  @IsBoolean()
  isActive: boolean;
}
