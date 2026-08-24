import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { AutomationType } from '@prisma/client';

export class CreateAutomationDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(AutomationType)
  type: AutomationType;

  @IsInt()
  @Min(1)
  daysAfter: number;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  cooldownHours?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  messagingChannelId?: string;
}
