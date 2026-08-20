import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MediaAsset, MediaAssetStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { MediaStorageAdapter } from './contracts/media-storage-adapter.interface';
import type { CreateMediaAssetInput } from './contracts/media-asset.types';
import { MediaObjectKeyPolicy } from './firebase/media-object-key.policy';
import { MediaAssetService } from './media-asset.service';
import { MediaObjectKeyFactory } from './media-object-key.factory';

describe('MediaAssetService', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  const checksumSha256 =
    '53ccefc97d7330eeb396eb9d7f60d6bd413bffcc19c6d700ece42bbf5798b455';
  const prismaMock = {
    mediaAsset: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const storageAdapterMock: jest.Mocked<MediaStorageAdapter> = {
    uploadObject: jest.fn(),
    createTemporaryReadUrl: jest.fn(),
    deleteObject: jest.fn(),
  };
  const objectKeyFactory = new MediaObjectKeyFactory(
    new MediaObjectKeyPolicy(),
  );

  let service: MediaAssetService;
  let lastPendingAsset: MediaAsset;

  const input = (): CreateMediaAssetInput => {
    const content = Buffer.from('valid-image-content');

    return {
      companyId: 'company-1',
      originalName: 'campaign.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: content.length,
      content,
      expiresAt: new Date('2026-08-07T12:00:00.000Z'),
    };
  };

  const asset = (
    status: MediaAssetStatus,
    overrides: Partial<MediaAsset> = {},
  ): MediaAsset => ({
    id: 'asset-1',
    companyId: 'company-1',
    storageProvider: status === MediaAssetStatus.READY ? 'FIREBASE' : 'PENDING',
    bucket:
      status === MediaAssetStatus.READY
        ? 'project.firebasestorage.app'
        : 'PENDING',
    objectKey: 'companies/company-1/media/asset-1/campaign.jpg',
    originalName: 'campaign.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: Buffer.byteLength('valid-image-content'),
    checksumSha256,
    deduplicationKey:
      status === MediaAssetStatus.FAILED ? null : checksumSha256,
    status,
    expiresAt: new Date('2026-08-07T12:00:00.000Z'),
    storageDeletedAt: status === MediaAssetStatus.DELETED ? now : null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();

    prismaMock.mediaAsset.findUnique.mockImplementation(async ({ where }) => {
      if (where.id_companyId) {
        return asset(MediaAssetStatus.READY, {
          ...lastPendingAsset,
          storageProvider: 'FIREBASE',
          bucket: 'project.firebasestorage.app',
          status: MediaAssetStatus.READY,
        });
      }

      return null;
    });
    prismaMock.mediaAsset.create.mockImplementation(async ({ data }) => {
      lastPendingAsset = asset(MediaAssetStatus.PENDING, {
        id: data.id,
        companyId: data.companyId,
        storageProvider: data.storageProvider,
        bucket: data.bucket,
        objectKey: data.objectKey,
        originalName: data.originalName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        checksumSha256: data.checksumSha256,
        expiresAt: data.expiresAt,
      });

      return lastPendingAsset;
    });
    storageAdapterMock.uploadObject.mockImplementation(async (uploadInput) => ({
      storageProvider: 'FIREBASE',
      bucket: 'project.firebasestorage.app',
      objectKey: uploadInput.objectKey,
      sizeBytes: uploadInput.sizeBytes,
    }));
    prismaMock.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
    storageAdapterMock.deleteObject.mockResolvedValue({
      bucket: 'project.firebasestorage.app',
      objectKey: 'companies/company-1/media/asset-1/campaign.jpg',
      deletedAt: now,
    });

    service = new MediaAssetService(
      prismaMock as unknown as PrismaService,
      storageAdapterMock,
      objectKeyFactory,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('cria PENDING, calcula checksum, envia uma vez e retorna READY', async () => {
    const result = await service.create(input());
    const createCall = prismaMock.mediaAsset.create.mock.calls[0][0];
    const pendingId = createCall.data.id;
    const expectedObjectKey = `companies/company-1/media/${pendingId}/campaign.jpg`;

    expect(prismaMock.mediaAsset.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_deduplicationKey: {
          companyId: 'company-1',
          deduplicationKey: checksumSha256,
        },
      },
    });
    expect(createCall).toEqual({
      data: expect.objectContaining({
        id: expect.any(String),
        companyId: 'company-1',
        storageProvider: 'PENDING',
        bucket: 'PENDING',
        objectKey: expectedObjectKey,
        originalName: 'campaign.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: Buffer.byteLength('valid-image-content'),
        checksumSha256,
        deduplicationKey: checksumSha256,
        status: MediaAssetStatus.PENDING,
      }),
    });
    expect(storageAdapterMock.uploadObject).toHaveBeenCalledTimes(1);
    expect(storageAdapterMock.uploadObject).toHaveBeenCalledWith({
      companyId: 'company-1',
      mediaAssetId: pendingId,
      objectKey: expectedObjectKey,
      fileName: 'campaign.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: Buffer.byteLength('valid-image-content'),
      content: input().content,
    });
    expect(prismaMock.mediaAsset.updateMany).toHaveBeenCalledWith({
      where: {
        id: pendingId,
        companyId: 'company-1',
        status: MediaAssetStatus.PENDING,
      },
      data: {
        storageProvider: 'FIREBASE',
        bucket: 'project.firebasestorage.app',
        objectKey: expectedObjectKey,
        sizeBytes: Buffer.byteLength('valid-image-content'),
        status: MediaAssetStatus.READY,
      },
    });
    expect(prismaMock.mediaAsset.findUnique).toHaveBeenLastCalledWith({
      where: {
        id_companyId: {
          id: pendingId,
          companyId: 'company-1',
        },
      },
    });
    expect(result.status).toBe(MediaAssetStatus.READY);
    expect(result.companyId).toBe('company-1');
  });

  it.each([
    ['companyId vazio', { companyId: '   ' }, 'companyId is required'],
    ['originalName vazio', { originalName: '  ' }, 'originalName is required'],
    [
      'mimeType inválido',
      { mimeType: 'image/gif' },
      'mimeType is not supported',
    ],
    [
      'Buffer vazio',
      { content: Buffer.alloc(0), sizeBytes: 1 },
      'Media content size is invalid',
    ],
    ['sizeBytes zero', { sizeBytes: 0 }, 'Media content size is invalid'],
    ['sizeBytes negativo', { sizeBytes: -1 }, 'Media content size is invalid'],
    ['tamanho divergente', { sizeBytes: 999 }, 'Media content size is invalid'],
    [
      'expiresAt no passado',
      { expiresAt: new Date('2026-08-06T11:59:59.000Z') },
      'expiresAt is invalid',
    ],
  ])('rejeita %s antes do Prisma', async (_case, changes, message) => {
    await expect(
      service.create({ ...input(), ...changes } as CreateMediaAssetInput),
    ).rejects.toThrow(new BadRequestException(message));
    expect(prismaMock.mediaAsset.findUnique).not.toHaveBeenCalled();
    expect(storageAdapterMock.uploadObject).not.toHaveBeenCalled();
  });

  it('reutiliza READY existente sem criar ou enviar novamente', async () => {
    const readyAsset = asset(MediaAssetStatus.READY);
    prismaMock.mediaAsset.findUnique.mockResolvedValue(readyAsset);

    await expect(service.create(input())).resolves.toBe(readyAsset);
    expect(prismaMock.mediaAsset.create).not.toHaveBeenCalled();
    expect(storageAdapterMock.uploadObject).not.toHaveBeenCalled();
  });

  it('rejeita PENDING existente sem duplicar upload', async () => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue(
      asset(MediaAssetStatus.PENDING),
    );

    await expect(service.create(input())).rejects.toThrow(ConflictException);
    expect(prismaMock.mediaAsset.create).not.toHaveBeenCalled();
    expect(storageAdapterMock.uploadObject).not.toHaveBeenCalled();
  });

  it.each([MediaAssetStatus.DELETE_PENDING, MediaAssetStatus.DELETED])(
    '%s libera lock antigo e cria um novo upload sem reutilizar o asset',
    async (status) => {
      const historicalAsset = asset(status);
      prismaMock.mediaAsset.findUnique
        .mockResolvedValueOnce(historicalAsset)
        .mockImplementationOnce(async () =>
          asset(MediaAssetStatus.READY, {
            ...lastPendingAsset,
            storageProvider: 'FIREBASE',
            bucket: 'project.firebasestorage.app',
            status: MediaAssetStatus.READY,
          }),
        );

      const result = await service.create(input());

      expect(prismaMock.mediaAsset.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: historicalAsset.id,
          companyId: 'company-1',
          status,
          deduplicationKey: checksumSha256,
        },
        data: { deduplicationKey: null },
      });
      expect(result).toEqual(
        expect.objectContaining({ status: MediaAssetStatus.READY }),
      );
      expect(result.id).not.toBe(historicalAsset.id);
      expect(result.objectKey).not.toBe(historicalAsset.objectKey);
      expect(storageAdapterMock.uploadObject).toHaveBeenCalledTimes(1);
    },
  );

  it('READY expirado é retirado da deduplicação e não é reutilizado', async () => {
    const expiredAsset = asset(MediaAssetStatus.READY, {
      expiresAt: new Date('2026-08-06T11:59:59.000Z'),
    });
    prismaMock.mediaAsset.findUnique
      .mockResolvedValueOnce(expiredAsset)
      .mockImplementationOnce(async () =>
        asset(MediaAssetStatus.READY, {
          ...lastPendingAsset,
          storageProvider: 'FIREBASE',
          bucket: 'project.firebasestorage.app',
          status: MediaAssetStatus.READY,
        }),
      );

    const result = await service.create(input());

    expect(prismaMock.mediaAsset.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: expiredAsset.id,
        companyId: 'company-1',
        status: MediaAssetStatus.READY,
        deduplicationKey: checksumSha256,
        expiresAt: { lte: now },
      },
      data: {
        deduplicationKey: null,
        status: MediaAssetStatus.DELETE_PENDING,
      },
    });
    expect(result.id).not.toBe(expiredAsset.id);
    expect(result.objectKey).not.toBe(expiredAsset.objectKey);
    expect(storageAdapterMock.uploadObject).toHaveBeenCalledTimes(1);
  });

  it('não retorna asset de outro tenant mesmo sob resposta inconsistente', async () => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue(
      asset(MediaAssetStatus.READY, { companyId: 'company-2' }),
    );

    await expect(service.create(input())).rejects.toThrow(
      new ConflictException('Media asset cannot be reused'),
    );
    expect(storageAdapterMock.uploadObject).not.toHaveBeenCalled();
  });

  it('FAILED de outro tenant não participa da deduplicação da Company atual', async () => {
    const failedOtherTenant = asset(MediaAssetStatus.FAILED, {
      id: 'failed-company-2',
      companyId: 'company-2',
      deduplicationKey: null,
    });
    prismaMock.mediaAsset.findUnique.mockImplementation(async ({ where }) => {
      if (where.companyId_deduplicationKey) {
        expect(where.companyId_deduplicationKey.companyId).toBe('company-1');
        expect(failedOtherTenant.companyId).toBe('company-2');
        return null;
      }

      return asset(MediaAssetStatus.READY, {
        ...lastPendingAsset,
        storageProvider: 'FIREBASE',
        bucket: 'project.firebasestorage.app',
        status: MediaAssetStatus.READY,
      });
    });

    await expect(service.create(input())).resolves.toEqual(
      expect.objectContaining({
        companyId: 'company-1',
        status: MediaAssetStatus.READY,
      }),
    );
    expect(storageAdapterMock.uploadObject).toHaveBeenCalledTimes(1);
  });

  it('trata corrida P2002 carregando o PENDING sem upload duplicado', async () => {
    prismaMock.mediaAsset.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(asset(MediaAssetStatus.PENDING));
    prismaMock.mediaAsset.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['companyId', 'deduplicationKey'] },
      }),
    );

    await expect(service.create(input())).rejects.toThrow(ConflictException);
    expect(prismaMock.mediaAsset.findUnique).toHaveBeenCalledTimes(2);
    expect(storageAdapterMock.uploadObject).not.toHaveBeenCalled();
  });

  it('trata corrida P2002 reutilizando READY concluído pelo concorrente', async () => {
    const readyAsset = asset(MediaAssetStatus.READY);
    prismaMock.mediaAsset.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(readyAsset);
    prismaMock.mediaAsset.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: 'MediaAsset_companyId_deduplicationKey_key' },
      }),
    );

    await expect(service.create(input())).resolves.toBe(readyAsset);
    expect(storageAdapterMock.uploadObject).not.toHaveBeenCalled();
  });

  it('não trata P2002 de storage como deduplicação concorrente', async () => {
    prismaMock.mediaAsset.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Sensitive Prisma metadata', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['storageProvider', 'bucket', 'objectKey'] },
      }),
    );

    await expect(service.create(input())).rejects.toThrow(
      new InternalServerErrorException('Media asset could not be created'),
    );
    expect(prismaMock.mediaAsset.findUnique).toHaveBeenCalledTimes(1);
    expect(storageAdapterMock.uploadObject).not.toHaveBeenCalled();
  });

  it('marca FAILED quando o upload falha e retorna erro seguro', async () => {
    const secret = input().content.toString();
    storageAdapterMock.uploadObject.mockRejectedValue(
      new Error(`credential signed-url ${secret}`),
    );

    try {
      await service.create(input());
      throw new Error('Expected upload failure');
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as Error).message).toBe('Media asset upload failed');
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain('credential');
      expect((error as Error).message).not.toContain('signed-url');
    }

    expect(prismaMock.mediaAsset.updateMany).toHaveBeenCalledWith({
      where: {
        id: lastPendingAsset.id,
        companyId: 'company-1',
        status: MediaAssetStatus.PENDING,
      },
      data: {
        status: MediaAssetStatus.FAILED,
        deduplicationKey: null,
      },
    });
    expect(storageAdapterMock.deleteObject).not.toHaveBeenCalled();
  });

  it('cria uma nova identidade e objectKey ao repetir upload após FAILED', async () => {
    const storedAssets: MediaAsset[] = [];

    prismaMock.mediaAsset.findUnique.mockImplementation(async ({ where }) => {
      if (where.companyId_deduplicationKey) {
        const { companyId, deduplicationKey } =
          where.companyId_deduplicationKey;
        return (
          storedAssets.find(
            (storedAsset) =>
              storedAsset.companyId === companyId &&
              storedAsset.deduplicationKey === deduplicationKey,
          ) ?? null
        );
      }

      const { id, companyId } = where.id_companyId;
      return (
        storedAssets.find(
          (storedAsset) =>
            storedAsset.id === id && storedAsset.companyId === companyId,
        ) ?? null
      );
    });
    prismaMock.mediaAsset.create.mockImplementation(async ({ data }) => {
      const createdAsset = asset(MediaAssetStatus.PENDING, {
        ...data,
        expiresAt: data.expiresAt ?? null,
        storageDeletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      storedAssets.push(createdAsset);
      return createdAsset;
    });
    prismaMock.mediaAsset.updateMany.mockImplementation(
      async ({ where, data }) => {
        const storedAsset = storedAssets.find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.companyId === where.companyId &&
            candidate.status === where.status,
        );

        if (!storedAsset) return { count: 0 };
        Object.assign(storedAsset, data, { updatedAt: now });
        return { count: 1 };
      },
    );
    storageAdapterMock.uploadObject.mockRejectedValueOnce(
      new Error('Temporary Firebase authentication failure'),
    );

    await expect(service.create(input())).rejects.toThrow(
      new InternalServerErrorException('Media asset upload failed'),
    );

    const failedAttempt = storedAssets[0];
    expect(failedAttempt).toEqual(
      expect.objectContaining({
        status: MediaAssetStatus.FAILED,
        checksumSha256,
        deduplicationKey: null,
      }),
    );

    const retryResult = await service.create(input());

    expect(retryResult.status).toBe(MediaAssetStatus.READY);
    expect(storedAssets).toHaveLength(2);
    expect(retryResult.id).not.toBe(failedAttempt.id);
    expect(retryResult.objectKey).not.toBe(failedAttempt.objectKey);
    expect(failedAttempt.status).toBe(MediaAssetStatus.FAILED);
    expect(failedAttempt.checksumSha256).toBe(checksumSha256);
    expect(storageAdapterMock.uploadObject).toHaveBeenCalledTimes(2);
  });

  it('count 0 compensa sem sobrescrever estado concorrente', async () => {
    prismaMock.mediaAsset.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(asset(MediaAssetStatus.FAILED));
    prismaMock.mediaAsset.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.create(input())).rejects.toThrow(
      new InternalServerErrorException('Media asset could not be finalized'),
    );
    expect(storageAdapterMock.deleteObject).toHaveBeenCalledWith({
      bucket: 'project.firebasestorage.app',
      objectKey: lastPendingAsset.objectKey,
    });
    expect(prismaMock.mediaAsset.updateMany).toHaveBeenCalledTimes(1);
  });

  it('não compensa quando count 1 é seguido por falha no reload', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    prismaMock.mediaAsset.findUnique
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('Sensitive database failure'));
    prismaMock.mediaAsset.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(service.create(input())).rejects.toThrow(
      new InternalServerErrorException('Media asset could not be finalized'),
    );
    expect(prismaMock.mediaAsset.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.mediaAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          status: MediaAssetStatus.PENDING,
        }),
        data: expect.objectContaining({ status: MediaAssetStatus.READY }),
      }),
    );
    expect(storageAdapterMock.deleteObject).not.toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith(
      'Media asset finalized but could not be reloaded',
    );
    expect(JSON.stringify(loggerSpy.mock.calls)).not.toContain('Sensitive');
  });

  it('confirma READY idêntico após erro ambíguo sem compensar', async () => {
    let readyAsset: MediaAsset;
    prismaMock.mediaAsset.findUnique
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async () => {
        readyAsset = asset(MediaAssetStatus.READY, {
          ...lastPendingAsset,
          storageProvider: 'FIREBASE',
          bucket: 'project.firebasestorage.app',
          status: MediaAssetStatus.READY,
        });
        return readyAsset;
      });
    prismaMock.mediaAsset.updateMany.mockRejectedValueOnce(
      new Error('Database response lost'),
    );

    const result = await service.create(input());

    expect(result).toBe(readyAsset!);
    expect(storageAdapterMock.deleteObject).not.toHaveBeenCalled();
    expect(prismaMock.mediaAsset.updateMany).toHaveBeenCalledTimes(1);
  });

  it('compensa READY com metadados diferentes sem retornar sucesso', async () => {
    prismaMock.mediaAsset.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        asset(MediaAssetStatus.READY, { objectKey: 'different-object-key' }),
      );
    prismaMock.mediaAsset.updateMany.mockRejectedValueOnce(
      new Error('Database response lost'),
    );

    await expect(service.create(input())).rejects.toThrow(
      new InternalServerErrorException('Media asset could not be finalized'),
    );
    expect(storageAdapterMock.deleteObject).toHaveBeenCalledTimes(1);
    expect(prismaMock.mediaAsset.updateMany).toHaveBeenCalledTimes(1);
  });

  it('compensa DELETE_PENDING sem alterar o estado para FAILED', async () => {
    prismaMock.mediaAsset.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(asset(MediaAssetStatus.DELETE_PENDING));
    prismaMock.mediaAsset.updateMany.mockRejectedValueOnce(
      new Error('Database response lost'),
    );

    await expect(service.create(input())).rejects.toThrow(
      new InternalServerErrorException('Media asset could not be finalized'),
    );
    expect(storageAdapterMock.deleteObject).toHaveBeenCalledTimes(1);
    expect(prismaMock.mediaAsset.updateMany).toHaveBeenCalledTimes(1);
  });

  it('compensa e retorna erro seguro quando a confirmação também falha', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    prismaMock.mediaAsset.findUnique
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('Sensitive database failure'));
    prismaMock.mediaAsset.updateMany.mockRejectedValueOnce(
      new Error('Database response lost'),
    );

    await expect(service.create(input())).rejects.toThrow(
      new InternalServerErrorException('Media asset could not be finalized'),
    );
    expect(storageAdapterMock.deleteObject).toHaveBeenCalledTimes(1);
    expect(loggerSpy).toHaveBeenCalledWith(
      'Media asset finalization state could not be confirmed',
    );
    expect(JSON.stringify(loggerSpy.mock.calls)).not.toContain('Sensitive');
  });

  it('compensa o upload quando a atualização para READY falha', async () => {
    prismaMock.mediaAsset.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(asset(MediaAssetStatus.PENDING));
    prismaMock.mediaAsset.updateMany.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );

    await expect(service.create(input())).rejects.toThrow(
      new InternalServerErrorException('Media asset could not be finalized'),
    );
    expect(storageAdapterMock.deleteObject).toHaveBeenCalledWith({
      bucket: 'project.firebasestorage.app',
      objectKey: lastPendingAsset.objectKey,
    });
    expect(prismaMock.mediaAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: lastPendingAsset.id,
          companyId: 'company-1',
        }),
        data: {
          status: MediaAssetStatus.FAILED,
          deduplicationKey: null,
        },
      }),
    );
  });

  it('não mascara falha principal quando a compensação também falha', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    prismaMock.mediaAsset.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(asset(MediaAssetStatus.PENDING));
    prismaMock.mediaAsset.updateMany.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );
    storageAdapterMock.deleteObject.mockRejectedValue(
      new Error('Sensitive storage failure'),
    );

    await expect(service.create(input())).rejects.toThrow(
      new InternalServerErrorException('Media asset could not be finalized'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      'Media asset upload compensation failed',
    );
    expect(JSON.stringify(loggerSpy.mock.calls)).not.toContain('Sensitive');
  });
});
