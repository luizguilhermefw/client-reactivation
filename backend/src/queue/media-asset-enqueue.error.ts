import { BadRequestException } from '@nestjs/common';

export type MediaAssetEnqueueErrorCode =
  | 'MEDIA_ASSET_NOT_FOUND'
  | 'MEDIA_ASSET_NOT_READY'
  | 'MEDIA_ASSET_EXPIRED';

export class MediaAssetEnqueueError extends BadRequestException {
  constructor(
    public readonly code: MediaAssetEnqueueErrorCode,
    message: string,
  ) {
    super(message);
  }
}
