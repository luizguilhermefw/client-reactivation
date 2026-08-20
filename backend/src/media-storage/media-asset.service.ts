import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MediaAsset, MediaAssetStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { MediaStorageAdapter } from './contracts/media-storage-adapter.interface';
import type {
  CreateMediaAssetInput,
  SupportedMediaAssetMimeType,
} from './contracts/media-asset.types';
import type { UploadMediaObjectResult } from './contracts/media-storage.types';
import { MEDIA_STORAGE_ADAPTER } from './media-storage-adapter.token';
import { MediaObjectKeyFactory } from './media-object-key.factory';

interface ValidatedMediaAssetInput {
  companyId: string;
  originalName: string;
  mimeType: SupportedMediaAssetMimeType;
  sizeBytes: number;
  content: Buffer;
  expiresAt: Date | null;
}

@Injectable()
export class MediaAssetService {
  private static readonly PENDING_STORAGE_PROVIDER = 'PENDING';
  private static readonly PENDING_BUCKET = 'PENDING';
  private static readonly SAFE_UPLOAD_ERROR = 'Media asset upload failed';
  private static readonly SAFE_FINALIZATION_ERROR =
    'Media asset could not be finalized';

  private readonly logger = new Logger(MediaAssetService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE_ADAPTER)
    private readonly storageAdapter: MediaStorageAdapter,
    private readonly objectKeyFactory: MediaObjectKeyFactory,
  ) {}

  async create(input: CreateMediaAssetInput): Promise<MediaAsset> {
    const validatedInput = this.validateInput(input);
    const checksumSha256 = createHash('sha256')
      .update(validatedInput.content)
      .digest('hex');
    const existingAsset = await this.findByDeduplicationKeyForCompany(
      validatedInput.companyId,
      checksumSha256,
    );

    if (existingAsset) {
      const reusableAsset = await this.prepareExistingAssetForUpload(
        existingAsset,
        validatedInput.companyId,
        checksumSha256,
      );

      if (reusableAsset) {
        return reusableAsset;
      }
    }

    const mediaAssetId = randomUUID();
    const objectKey = this.objectKeyFactory.create(
      validatedInput.companyId,
      mediaAssetId,
      validatedInput.originalName,
    );
    const pendingAsset = await this.createPendingAsset(
      validatedInput,
      mediaAssetId,
      objectKey,
      checksumSha256,
    );

    if (pendingAsset.status === MediaAssetStatus.READY) {
      return pendingAsset;
    }

    return this.uploadAndFinalize(pendingAsset, validatedInput);
  }

  private validateInput(
    input: CreateMediaAssetInput,
  ): ValidatedMediaAssetInput {
    const companyId = input.companyId?.trim();
    const originalName = input.originalName?.trim();

    if (!companyId) {
      throw new BadRequestException('companyId is required');
    }

    if (!originalName) {
      throw new BadRequestException('originalName is required');
    }

    if (input.mimeType !== 'image/jpeg' && input.mimeType !== 'image/png') {
      throw new BadRequestException('mimeType is not supported');
    }

    if (
      !Buffer.isBuffer(input.content) ||
      input.content.length === 0 ||
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.content.length !== input.sizeBytes
    ) {
      throw new BadRequestException('Media content size is invalid');
    }

    const expiresAt = input.expiresAt ?? null;

    if (
      expiresAt !== null &&
      (!(expiresAt instanceof Date) ||
        Number.isNaN(expiresAt.getTime()) ||
        expiresAt.getTime() <= Date.now())
    ) {
      throw new BadRequestException('expiresAt is invalid');
    }

    return {
      companyId,
      originalName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      content: input.content,
      expiresAt,
    };
  }

  private async findByDeduplicationKeyForCompany(
    companyId: string,
    checksumSha256: string,
  ): Promise<MediaAsset | null> {
    return this.prisma.mediaAsset.findUnique({
      where: {
        companyId_deduplicationKey: {
          companyId,
          deduplicationKey: checksumSha256,
        },
      },
    });
  }

  private async findByIdForCompany(
    mediaAssetId: string,
    companyId: string,
  ): Promise<MediaAsset | null> {
    return this.prisma.mediaAsset.findUnique({
      where: {
        id_companyId: {
          id: mediaAssetId,
          companyId,
        },
      },
    });
  }

  private async createPendingAsset(
    input: ValidatedMediaAssetInput,
    mediaAssetId: string,
    objectKey: string,
    checksumSha256: string,
    mayRetryAfterLockRelease = true,
  ): Promise<MediaAsset> {
    try {
      return await this.prisma.mediaAsset.create({
        data: {
          id: mediaAssetId,
          companyId: input.companyId,
          storageProvider: MediaAssetService.PENDING_STORAGE_PROVIDER,
          bucket: MediaAssetService.PENDING_BUCKET,
          objectKey,
          originalName: input.originalName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          checksumSha256,
          deduplicationKey: checksumSha256,
          status: MediaAssetStatus.PENDING,
          expiresAt: input.expiresAt,
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw new InternalServerErrorException(
          'Media asset could not be created',
        );
      }

      const concurrentAsset = await this.findByDeduplicationKeyForCompany(
        input.companyId,
        checksumSha256,
      );

      if (!concurrentAsset) {
        throw new ConflictException('Media asset creation conflicted');
      }

      const reusableAsset = await this.prepareExistingAssetForUpload(
        concurrentAsset,
        input.companyId,
        checksumSha256,
      );

      if (reusableAsset) {
        return reusableAsset;
      }

      if (!mayRetryAfterLockRelease) {
        throw new ConflictException('Media asset creation conflicted');
      }

      return this.createPendingAsset(
        input,
        mediaAssetId,
        objectKey,
        checksumSha256,
        false,
      );
    }
  }

  private async prepareExistingAssetForUpload(
    asset: MediaAsset,
    companyId: string,
    deduplicationKey: string,
  ): Promise<MediaAsset | null> {
    if (asset.companyId !== companyId) {
      throw new ConflictException('Media asset cannot be reused');
    }

    if (asset.status === MediaAssetStatus.PENDING) {
      throw new ConflictException('Media asset upload is already in progress');
    }

    if (
      asset.status === MediaAssetStatus.READY &&
      (!asset.expiresAt || asset.expiresAt.getTime() > Date.now())
    ) {
      return asset;
    }

    const expiringReadyAsset = asset.status === MediaAssetStatus.READY;
    const release = await this.prisma.mediaAsset.updateMany({
      where: {
        id: asset.id,
        companyId,
        status: asset.status,
        deduplicationKey,
        ...(expiringReadyAsset
          ? { expiresAt: { lte: new Date() } }
          : undefined),
      },
      data: {
        deduplicationKey: null,
        ...(expiringReadyAsset
          ? { status: MediaAssetStatus.DELETE_PENDING }
          : undefined),
      },
    });

    if (release.count !== 1) {
      throw new ConflictException(
        'Media asset state changed during upload preparation',
      );
    }

    return null;
  }

  private async uploadAndFinalize(
    pendingAsset: MediaAsset,
    input: ValidatedMediaAssetInput,
  ): Promise<MediaAsset> {
    let uploadResult: UploadMediaObjectResult;

    try {
      uploadResult = await this.storageAdapter.uploadObject({
        companyId: input.companyId,
        mediaAssetId: pendingAsset.id,
        objectKey: pendingAsset.objectKey,
        fileName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        content: input.content,
      });
    } catch {
      await this.tryMarkFailed(pendingAsset.id, input.companyId);
      throw new InternalServerErrorException(
        MediaAssetService.SAFE_UPLOAD_ERROR,
      );
    }

    let transition: { count: number };

    try {
      transition = await this.prisma.mediaAsset.updateMany({
        where: {
          id: pendingAsset.id,
          companyId: input.companyId,
          status: MediaAssetStatus.PENDING,
        },
        data: {
          storageProvider: uploadResult.storageProvider,
          bucket: uploadResult.bucket,
          objectKey: uploadResult.objectKey,
          sizeBytes: uploadResult.sizeBytes,
          status: MediaAssetStatus.READY,
        },
      });
    } catch {
      return this.reconcileFinalizationFailure(
        pendingAsset,
        input.companyId,
        uploadResult,
      );
    }

    if (transition.count !== 1) {
      return this.reconcileFinalizationFailure(
        pendingAsset,
        input.companyId,
        uploadResult,
      );
    }

    let finalizedAsset: MediaAsset | null;

    try {
      finalizedAsset = await this.findByIdForCompany(
        pendingAsset.id,
        input.companyId,
      );
    } catch {
      return this.failAfterConfirmedFinalizationReload();
    }

    if (this.isMatchingReadyAsset(finalizedAsset, uploadResult)) {
      return finalizedAsset;
    }

    return this.compensateFinalizationFailure(
      pendingAsset,
      input.companyId,
      uploadResult,
      finalizedAsset,
    );
  }

  private failAfterConfirmedFinalizationReload(): never {
    this.logger.error('Media asset finalized but could not be reloaded');
    throw new InternalServerErrorException(
      MediaAssetService.SAFE_FINALIZATION_ERROR,
    );
  }

  private async reconcileFinalizationFailure(
    pendingAsset: MediaAsset,
    companyId: string,
    uploadResult: UploadMediaObjectResult,
  ): Promise<MediaAsset> {
    let confirmedAsset: MediaAsset | null;

    try {
      confirmedAsset = await this.findByIdForCompany(
        pendingAsset.id,
        companyId,
      );
    } catch {
      return this.compensateUnconfirmedFinalization(uploadResult);
    }

    if (this.isMatchingReadyAsset(confirmedAsset, uploadResult)) {
      return confirmedAsset;
    }

    return this.compensateFinalizationFailure(
      pendingAsset,
      companyId,
      uploadResult,
      confirmedAsset,
    );
  }

  private async compensateUnconfirmedFinalization(
    uploadResult: UploadMediaObjectResult,
  ): Promise<never> {
    this.logger.error('Media asset finalization state could not be confirmed');
    await this.tryCompensateUpload(uploadResult);
    throw new InternalServerErrorException(
      MediaAssetService.SAFE_FINALIZATION_ERROR,
    );
  }

  private async compensateFinalizationFailure(
    pendingAsset: MediaAsset,
    companyId: string,
    uploadResult: UploadMediaObjectResult,
    confirmedAsset: MediaAsset | null,
  ): Promise<never> {
    await this.tryCompensateUpload(uploadResult);

    if (confirmedAsset?.status === MediaAssetStatus.PENDING) {
      await this.tryMarkFailed(pendingAsset.id, companyId);
    }

    throw new InternalServerErrorException(
      MediaAssetService.SAFE_FINALIZATION_ERROR,
    );
  }

  private isMatchingReadyAsset(
    asset: MediaAsset | null,
    uploadResult: UploadMediaObjectResult,
  ): asset is MediaAsset {
    return (
      asset?.status === MediaAssetStatus.READY &&
      asset.storageProvider === uploadResult.storageProvider &&
      asset.bucket === uploadResult.bucket &&
      asset.objectKey === uploadResult.objectKey &&
      asset.sizeBytes === uploadResult.sizeBytes
    );
  }

  private async tryMarkFailed(
    mediaAssetId: string,
    companyId: string,
  ): Promise<void> {
    try {
      await this.prisma.mediaAsset.updateMany({
        where: {
          id: mediaAssetId,
          companyId,
          status: MediaAssetStatus.PENDING,
        },
        data: {
          status: MediaAssetStatus.FAILED,
          deduplicationKey: null,
        },
      });
    } catch {
      this.logger.error('Media asset failure status update failed');
    }
  }

  private async tryCompensateUpload(
    uploadResult: UploadMediaObjectResult,
  ): Promise<void> {
    try {
      await this.storageAdapter.deleteObject({
        bucket: uploadResult.bucket,
        objectKey: uploadResult.objectKey,
      });
    } catch {
      this.logger.error('Media asset upload compensation failed');
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;

    if (Array.isArray(target)) {
      return (
        target.includes('companyId') && target.includes('deduplicationKey')
      );
    }

    return (
      typeof target === 'string' &&
      target.includes('companyId') &&
      target.includes('deduplicationKey')
    );
  }
}
