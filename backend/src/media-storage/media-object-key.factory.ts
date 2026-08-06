import { Injectable } from '@nestjs/common';
import { MediaObjectKeyPolicy } from './firebase/media-object-key.policy';

export const MAX_MEDIA_OBJECT_FILE_NAME_LENGTH = 120;

@Injectable()
export class MediaObjectKeyFactory {
  constructor(private readonly objectKeyPolicy: MediaObjectKeyPolicy) {}

  create(
    companyId: string,
    mediaAssetId: string,
    originalName: string,
  ): string {
    const safeFileName = this.sanitizeFileName(originalName);
    const objectKey = `companies/${companyId}/media/${mediaAssetId}/${safeFileName}`;

    this.objectKeyPolicy.assertOwnedByTenant(objectKey, companyId);

    return objectKey;
  }

  private sanitizeFileName(originalName: string): string {
    const withoutQueryOrFragment = originalName.split(/[?#]/u, 1)[0];
    const pathSegments = withoutQueryOrFragment.split(/[\\/]/u);
    const baseName = pathSegments.at(-1) ?? '';
    const extensionMatch = baseName.match(/\.([a-z\d]{1,10})$/iu);
    const extension = extensionMatch
      ? `.${extensionMatch[1].toLowerCase()}`
      : '';
    const stem = extension ? baseName.slice(0, -extension.length) : baseName;
    const sanitizedStem = stem
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .replace(/[\u0000-\u001f\u007f]/gu, '')
      .replace(/[^a-z\d_-]+/giu, '-')
      .replace(/^-+|-+$/gu, '');
    const fallbackStem =
      sanitizedStem && sanitizedStem !== '.' && sanitizedStem !== '..'
        ? sanitizedStem
        : 'file';
    const maxStemLength = MAX_MEDIA_OBJECT_FILE_NAME_LENGTH - extension.length;

    return `${fallbackStem.slice(0, maxStemLength)}${extension}`;
  }
}
