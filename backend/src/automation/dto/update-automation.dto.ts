import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

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
}
