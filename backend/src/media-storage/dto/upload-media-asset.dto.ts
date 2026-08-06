import { IsISO8601, IsOptional } from 'class-validator';

export class UploadMediaAssetDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}
