import { IsString, IsNotEmpty, IsInt, Min } from 'class-validator';

export class CreateAutomationDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(1)
  daysAfter: number;

  @IsString()
  @IsNotEmpty()
  message: string;
}