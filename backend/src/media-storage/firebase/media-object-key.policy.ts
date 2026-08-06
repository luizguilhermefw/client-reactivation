import { Injectable } from '@nestjs/common';

export class InvalidMediaObjectKeyError extends Error {
  readonly name = 'InvalidMediaObjectKeyError';

  constructor() {
    super('Media object key is invalid');
  }
}

@Injectable()
export class MediaObjectKeyPolicy {
  assertValid(objectKey: string): void {
    if (
      typeof objectKey !== 'string' ||
      !objectKey ||
      objectKey.startsWith('/') ||
      objectKey.includes('\\') ||
      objectKey.includes('?') ||
      objectKey.includes('#') ||
      /[\u0000-\u001f\u007f]/u.test(objectKey) ||
      /^[a-z][a-z\d+.-]*:/iu.test(objectKey)
    ) {
      throw new InvalidMediaObjectKeyError();
    }

    const segments = objectKey.split('/');

    if (
      segments.some(
        (segment) => segment === '' || segment === '.' || segment === '..',
      )
    ) {
      throw new InvalidMediaObjectKeyError();
    }
  }

  assertOwnedByTenant(objectKey: string, companyId: string): void {
    this.assertValid(objectKey);

    if (!this.isValidTenantSegment(companyId)) {
      throw new InvalidMediaObjectKeyError();
    }

    const expectedPrefix = `companies/${companyId}/`;

    if (!objectKey.startsWith(expectedPrefix)) {
      throw new InvalidMediaObjectKeyError();
    }
  }

  private isValidTenantSegment(companyId: string): boolean {
    return (
      typeof companyId === 'string' &&
      companyId.length > 0 &&
      companyId.trim() === companyId &&
      companyId !== '.' &&
      companyId !== '..' &&
      !companyId.includes('/') &&
      !companyId.includes('\\') &&
      !companyId.includes('?') &&
      !companyId.includes('#') &&
      !/[\u0000-\u001f\u007f]/u.test(companyId)
    );
  }
}
