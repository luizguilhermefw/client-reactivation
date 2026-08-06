import {
  BadRequestException,
  Body,
  Controller,
  PayloadTooLargeException,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, MulterModuleOptions } from '@nestjs/platform-express';
import { isISO8601 } from 'class-validator';
import { memoryStorage } from 'multer';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { MediaAssetResponseDto } from './dto/media-asset-response.dto';
import { UploadMediaAssetDto } from './dto/upload-media-asset.dto';
import { MediaAssetService } from './media-asset.service';

export const MAX_MEDIA_ASSET_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_MEDIA_ASSET_CLIENT_PARTS = 2;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

interface UploadedImageFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const MEDIA_ASSET_UPLOAD_OPTIONS: MulterModuleOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_MEDIA_ASSET_UPLOAD_BYTES,
    files: 1,
    fields: 1,
    // Busboy emits partsLimit when its counter reaches the configured value.
    // One file plus one optional field therefore requires a sentinel of 3.
    parts: MAX_MEDIA_ASSET_CLIENT_PARTS + 1,
  },
  fileFilter: (
    _request: unknown,
    file: UploadedImageFile,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      callback(
        new BadRequestException('Only JPEG and PNG images are allowed'),
        false,
      );
      return;
    }

    callback(null, true);
  },
};

@UseGuards(JwtAuthGuard, CompanyActiveGuard)
@Controller('media-assets')
export class MediaAssetController {
  constructor(private readonly mediaAssetService: MediaAssetService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', MEDIA_ASSET_UPLOAD_OPTIONS))
  async create(
    @Req() request: RequestWithUser,
    @UploadedFile() file: UploadedImageFile | undefined,
    @Body() dto: UploadMediaAssetDto,
  ): Promise<MediaAssetResponseDto> {
    this.assertValidFile(file);
    const expiresAt = this.parseExpiresAt(dto.expiresAt);
    const asset = await this.mediaAssetService.create({
      companyId: request.user.companyId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      content: file.buffer,
      expiresAt,
    });

    return MediaAssetResponseDto.fromMediaAsset(asset);
  }

  private assertValidFile(
    file: UploadedImageFile | undefined,
  ): asserts file is UploadedImageFile {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    if (
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.length === 0 ||
      file.size <= 0 ||
      file.size !== file.buffer.length
    ) {
      throw new BadRequestException('Image file is empty or invalid');
    }

    if (file.size > MAX_MEDIA_ASSET_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('Image exceeds 5 MiB limit');
    }

    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Only JPEG and PNG images are allowed');
    }
  }

  private parseExpiresAt(value: string | undefined): Date | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!isISO8601(value, { strict: true })) {
      throw new BadRequestException('expiresAt must be a valid ISO-8601 date');
    }

    const expiresAt = new Date(value);

    if (
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    return expiresAt;
  }
}
