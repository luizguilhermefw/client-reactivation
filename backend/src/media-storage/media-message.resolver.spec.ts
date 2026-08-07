import { MediaAsset, MediaAssetStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { MediaStorageAdapter } from './contracts/media-storage-adapter.interface';
import type { MediaReadUrlConfig } from './media-read-url.config';
import {
  MediaMessageResolutionError,
  MediaMessageResolver,
} from './media-message.resolver';

describe('MediaMessageResolver', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  const companyId = 'company-1';
  const mediaAssetId = 'asset-1';
  const prismaMock = {
    mediaAsset: {
      findUnique: jest.fn(),
    },
  };
  const storageAdapterMock: jest.Mocked<MediaStorageAdapter> = {
    uploadObject: jest.fn(),
    createTemporaryReadUrl: jest.fn(),
    deleteObject: jest.fn(),
  };
  const readUrlConfigMock: jest.Mocked<MediaReadUrlConfig> = {
    getTtlSeconds: jest.fn(),
  };
  const readyAsset: MediaAsset = {
    id: mediaAssetId,
    companyId,
    storageProvider: 'FIREBASE',
    bucket: 'configured-bucket',
    objectKey: 'companies/company-1/media/asset-1/image.jpg',
    originalName: 'image.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 123_456,
    checksumSha256: 'a'.repeat(64),
    status: MediaAssetStatus.READY,
    expiresAt: new Date('2026-08-07T12:00:00.000Z'),
    storageDeletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  let resolver: MediaMessageResolver;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();
    prismaMock.mediaAsset.findUnique.mockResolvedValue(readyAsset);
    readUrlConfigMock.getTtlSeconds.mockReturnValue(900);
    storageAdapterMock.createTemporaryReadUrl.mockResolvedValue({
      url: 'https://signed.example.test/private-media',
      expiresAt: new Date('2026-08-06T12:15:00.000Z'),
    });
    resolver = new MediaMessageResolver(
      prismaMock as unknown as PrismaService,
      storageAdapterMock,
      readUrlConfigMock,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('busca por id e companyId e cria URL temporária com o TTL configurado', async () => {
    await expect(resolver.resolve(mediaAssetId, companyId)).resolves.toBe(
      'https://signed.example.test/private-media',
    );
    expect(prismaMock.mediaAsset.findUnique).toHaveBeenCalledWith({
      where: {
        id_companyId: {
          id: mediaAssetId,
          companyId,
        },
      },
    });
    expect(storageAdapterMock.createTemporaryReadUrl).toHaveBeenCalledWith({
      bucket: readyAsset.bucket,
      objectKey: readyAsset.objectKey,
      expiresInSeconds: 900,
    });
  });

  it('falha terminalmente quando o asset não existe', async () => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue(null);

    await expect(
      resolver.resolve(mediaAssetId, companyId),
    ).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_FOUND',
      retryable: false,
    });
    expect(storageAdapterMock.createTemporaryReadUrl).not.toHaveBeenCalled();
  });

  it('normaliza falha sensível de lookup como retryable', async () => {
    const sensitiveError =
      'Prisma SQL connection failed at postgres://secret for asset-1 company-1';
    prismaMock.mediaAsset.findUnique.mockRejectedValue(
      new Error(sensitiveError),
    );

    try {
      await resolver.resolve(mediaAssetId, companyId);
      throw new Error('Expected media asset lookup failure');
    } catch (error) {
      expect(error).toBeInstanceOf(MediaMessageResolutionError);
      expect(error).toMatchObject({
        message: 'Media asset could not be loaded',
        code: 'MEDIA_ASSET_LOOKUP_FAILED',
        retryable: true,
      });
      expect((error as Error).message).not.toContain(sensitiveError);
      expect((error as Error).message).not.toContain(mediaAssetId);
      expect((error as Error).message).not.toContain(companyId);
    }

    expect(storageAdapterMock.createTemporaryReadUrl).not.toHaveBeenCalled();
  });

  it('não retorna asset de outro tenant mesmo sob resposta inconsistente', async () => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue({
      ...readyAsset,
      companyId: 'company-2',
    });

    await expect(
      resolver.resolve(mediaAssetId, companyId),
    ).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_FOUND',
      retryable: false,
    });
    expect(storageAdapterMock.createTemporaryReadUrl).not.toHaveBeenCalled();
  });

  it.each([
    [MediaAssetStatus.PENDING, true],
    [MediaAssetStatus.FAILED, false],
    [MediaAssetStatus.DELETE_PENDING, false],
    [MediaAssetStatus.DELETED, false],
  ])('rejeita estado %s com retryable=%s', async (status, retryable) => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue({
      ...readyAsset,
      status,
    });

    await expect(
      resolver.resolve(mediaAssetId, companyId),
    ).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_READY',
      retryable,
    });
    expect(storageAdapterMock.createTemporaryReadUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['storageProvider', { storageProvider: '   ' }],
    ['bucket', { bucket: '' }],
    ['objectKey', { objectKey: '   ' }],
  ])('rejeita asset READY sem %s', async (_field, override) => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue({
      ...readyAsset,
      ...override,
    });

    await expect(
      resolver.resolve(mediaAssetId, companyId),
    ).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_READY',
      retryable: false,
    });
    expect(storageAdapterMock.createTemporaryReadUrl).not.toHaveBeenCalled();
  });

  it('rejeita asset expirado de forma terminal', async () => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue({
      ...readyAsset,
      expiresAt: now,
    });

    await expect(
      resolver.resolve(mediaAssetId, companyId),
    ).rejects.toMatchObject({
      code: 'MEDIA_ASSET_EXPIRED',
      retryable: false,
    });
    expect(storageAdapterMock.createTemporaryReadUrl).not.toHaveBeenCalled();
  });

  it('normaliza falha de URL temporária sem expor detalhes', async () => {
    storageAdapterMock.createTemporaryReadUrl.mockRejectedValue(
      new Error(
        `credential ${readyAsset.bucket} ${readyAsset.objectKey} signed-url`,
      ),
    );

    try {
      await resolver.resolve(mediaAssetId, companyId);
      throw new Error('Expected URL generation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(MediaMessageResolutionError);
      expect(error).toMatchObject({
        message: 'Temporary media URL could not be created',
        code: 'MEDIA_READ_URL_FAILED',
        retryable: true,
      });
      expect((error as Error).message).not.toContain(readyAsset.bucket);
      expect((error as Error).message).not.toContain(readyAsset.objectKey);
      expect((error as Error).message).not.toContain('credential');
    }
  });
});
