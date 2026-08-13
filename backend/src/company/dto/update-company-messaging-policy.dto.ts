import { UnknownContactPolicy } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class UpdateCompanyMessagingPolicyDto {
  @IsEnum(UnknownContactPolicy)
  policy: UnknownContactPolicy;

  @IsOptional()
  @IsBoolean()
  declarationAccepted?: boolean;
}
