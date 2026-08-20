import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateOptOutInstructionsDto {
  @IsBoolean()
  includeOptOutInstructions: boolean;

  @IsOptional()
  @IsBoolean()
  responsibilityAcknowledged?: boolean;
}
