import { MediaAsset, MediaAssetStatus } from '@prisma/client';

export class MediaAssetResponseDto {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: MediaAssetStatus;
  checksumSha256: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  static fromMediaAsset(asset: MediaAsset): MediaAssetResponseDto {
    return {
      id: asset.id,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      status: asset.status,
      checksumSha256: asset.checksumSha256,
      expiresAt: asset.expiresAt,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    };
  }
}
