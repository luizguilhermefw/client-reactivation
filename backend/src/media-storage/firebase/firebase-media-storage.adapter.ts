import { Inject, Injectable } from '@nestjs/common';
import type { MediaStorageAdapter } from '../contracts/media-storage-adapter.interface';
import {
  CreateTemporaryReadUrlInput,
  CreateTemporaryReadUrlResult,
  DeleteMediaObjectInput,
  DeleteMediaObjectResult,
  UploadMediaObjectInput,
  UploadMediaObjectResult,
} from '../contracts/media-storage.types';
import type { FirebaseStorageBucket } from './firebase-storage-client.interface';
import type { FirebaseStorageConfig } from './firebase-storage.config';
import {
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_STORAGE_CONFIG,
} from './firebase-storage.tokens';
import { MediaObjectKeyPolicy } from './media-object-key.policy';

export class FirebaseMediaStorageError extends Error {
  readonly name = 'FirebaseMediaStorageError';
}

@Injectable()
export class FirebaseMediaStorageAdapter implements MediaStorageAdapter {
  static readonly STORAGE_PROVIDER = 'FIREBASE';
  static readonly MIN_SIGNED_URL_TTL_SECONDS = 60;
  static readonly MAX_SIGNED_URL_TTL_SECONDS = 3_600;

  constructor(
    @Inject(FIREBASE_STORAGE_BUCKET)
    private readonly bucket: FirebaseStorageBucket,
    @Inject(FIREBASE_STORAGE_CONFIG)
    private readonly config: FirebaseStorageConfig,
    private readonly objectKeyPolicy: MediaObjectKeyPolicy,
  ) {}

  async uploadObject(
    input: UploadMediaObjectInput,
  ): Promise<UploadMediaObjectResult> {
    this.objectKeyPolicy.assertOwnedByTenant(input.objectKey, input.companyId);

    if (
      !Buffer.isBuffer(input.content) ||
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.content.length === 0 ||
      input.content.length !== input.sizeBytes
    ) {
      throw new FirebaseMediaStorageError(
        'Media content size does not match declared size',
      );
    }

    const file = this.bucket.file(input.objectKey);

    try {
      await file.save(input.content, {
        resumable: false,
        metadata: {
          contentType: input.mimeType,
          metadata: {
            companyId: input.companyId,
            mediaAssetId: input.mediaAssetId,
            originalFileName: input.fileName,
          },
        },
        preconditionOpts: {
          ifGenerationMatch: 0,
        },
      });
    } catch (error) {
      if (this.isPreconditionFailed(error)) {
        throw new FirebaseMediaStorageError('Media object already exists');
      }

      throw error;
    }

    return {
      storageProvider: FirebaseMediaStorageAdapter.STORAGE_PROVIDER,
      bucket: this.config.bucket,
      objectKey: input.objectKey,
      sizeBytes: input.sizeBytes,
    };
  }

  async createTemporaryReadUrl(
    input: CreateTemporaryReadUrlInput,
  ): Promise<CreateTemporaryReadUrlResult> {
    this.assertConfiguredBucket(input.bucket);
    this.objectKeyPolicy.assertValid(input.objectKey);

    if (
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds <
        FirebaseMediaStorageAdapter.MIN_SIGNED_URL_TTL_SECONDS ||
      input.expiresInSeconds >
        FirebaseMediaStorageAdapter.MAX_SIGNED_URL_TTL_SECONDS
    ) {
      throw new FirebaseMediaStorageError(
        'Temporary media URL expiration is invalid',
      );
    }

    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1_000);
    const [url] = await this.bucket.file(input.objectKey).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });

    return { url, expiresAt };
  }

  async deleteObject(
    input: DeleteMediaObjectInput,
  ): Promise<DeleteMediaObjectResult> {
    this.assertConfiguredBucket(input.bucket);
    this.objectKeyPolicy.assertValid(input.objectKey);

    await this.bucket.file(input.objectKey).delete({
      ignoreNotFound: true,
    });

    return {
      bucket: this.config.bucket,
      objectKey: input.objectKey,
      deletedAt: new Date(),
    };
  }

  private assertConfiguredBucket(bucket: string): void {
    if (bucket !== this.config.bucket || bucket.includes('*')) {
      throw new FirebaseMediaStorageError(
        'Media storage bucket is not allowed',
      );
    }
  }

  private isPreconditionFailed(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const value = error as Record<string, unknown>;

    if (value.code === 412 || value.code === '412') {
      return true;
    }

    if (!value.response || typeof value.response !== 'object') {
      return false;
    }

    const response = value.response as Record<string, unknown>;
    return response.status === 412;
  }
}
