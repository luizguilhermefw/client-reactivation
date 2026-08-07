import { Inject, Injectable } from '@nestjs/common';
import { MediaAsset, MediaAssetStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { MediaStorageAdapter } from './contracts/media-storage-adapter.interface';
import { MEDIA_READ_URL_CONFIG } from './media-read-url.config';
import type { MediaReadUrlConfig } from './media-read-url.config';
import { MEDIA_STORAGE_ADAPTER } from './media-storage-adapter.token';

export type MediaMessageResolutionErrorCode =
  | 'MEDIA_ASSET_NOT_FOUND'
  | 'MEDIA_ASSET_LOOKUP_FAILED'
  | 'MEDIA_ASSET_NOT_READY'
  | 'MEDIA_ASSET_EXPIRED'
  | 'MEDIA_READ_URL_FAILED';

export class MediaMessageResolutionError extends Error {
  readonly name = 'MediaMessageResolutionError';

  constructor(
    message: string,
    readonly code: MediaMessageResolutionErrorCode,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

@Injectable()
export class MediaMessageResolver {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE_ADAPTER)
    private readonly storageAdapter: MediaStorageAdapter,
    @Inject(MEDIA_READ_URL_CONFIG)
    private readonly readUrlConfig: MediaReadUrlConfig,
  ) {}

  async resolve(mediaAssetId: string, companyId: string): Promise<string> {
    let asset: MediaAsset | null;

    try {
      asset = await this.prisma.mediaAsset.findUnique({
        where: {
          id_companyId: {
            id: mediaAssetId,
            companyId,
          },
        },
      });
    } catch {
      throw new MediaMessageResolutionError(
        'Media asset could not be loaded',
        'MEDIA_ASSET_LOOKUP_FAILED',
        true,
      );
    }

    if (!asset || asset.companyId !== companyId) {
      throw new MediaMessageResolutionError(
        'Media asset was not found',
        'MEDIA_ASSET_NOT_FOUND',
        false,
      );
    }

    this.assertReady(asset);

    if (asset.expiresAt && asset.expiresAt.getTime() <= Date.now()) {
      throw new MediaMessageResolutionError(
        'Media asset has expired',
        'MEDIA_ASSET_EXPIRED',
        false,
      );
    }

    try {
      const result = await this.storageAdapter.createTemporaryReadUrl({
        bucket: asset.bucket,
        objectKey: asset.objectKey,
        expiresInSeconds: this.readUrlConfig.getTtlSeconds(),
      });

      if (!result.url?.trim()) {
        throw new Error('Temporary media URL is empty');
      }

      return result.url;
    } catch {
      throw new MediaMessageResolutionError(
        'Temporary media URL could not be created',
        'MEDIA_READ_URL_FAILED',
        true,
      );
    }
  }

  private assertReady(asset: MediaAsset): void {
    if (
      asset.status !== MediaAssetStatus.READY ||
      !asset.storageProvider.trim() ||
      !asset.bucket.trim() ||
      !asset.objectKey.trim()
    ) {
      throw new MediaMessageResolutionError(
        'Media asset is not ready',
        'MEDIA_ASSET_NOT_READY',
        asset.status === MediaAssetStatus.PENDING,
      );
    }
  }
}
