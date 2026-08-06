import type {
  CreateTemporaryReadUrlInput,
  DeleteMediaObjectInput,
  UploadMediaObjectInput,
} from '../contracts/media-storage.types';
import {
  FirebaseMediaStorageAdapter,
  FirebaseMediaStorageError,
} from './firebase-media-storage.adapter';
import type {
  FirebaseStorageBucket,
  FirebaseStorageFile,
} from './firebase-storage-client.interface';
import type { FirebaseStorageConfig } from './firebase-storage.config';
import { MediaObjectKeyPolicy } from './media-object-key.policy';

describe('FirebaseMediaStorageAdapter', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  const signedUrl = 'https://signed.example.com/temporary-object';
  const config: FirebaseStorageConfig = {
    projectId: 'test-project',
    bucket: 'test-project.firebasestorage.app',
  };
  const saveMock = jest.fn<
    ReturnType<FirebaseStorageFile['save']>,
    Parameters<FirebaseStorageFile['save']>
  >();
  const getSignedUrlMock = jest.fn<
    ReturnType<FirebaseStorageFile['getSignedUrl']>,
    Parameters<FirebaseStorageFile['getSignedUrl']>
  >();
  const deleteMock = jest.fn<
    ReturnType<FirebaseStorageFile['delete']>,
    Parameters<FirebaseStorageFile['delete']>
  >();
  const file: FirebaseStorageFile = {
    save: saveMock,
    getSignedUrl: getSignedUrlMock,
    delete: deleteMock,
  };
  const fileMock = jest.fn(() => file);
  const bucket: FirebaseStorageBucket = {
    name: config.bucket,
    file: fileMock,
  };

  let adapter: FirebaseMediaStorageAdapter;

  const uploadInput = (): UploadMediaObjectInput => {
    const content = Buffer.from('jpeg-content');

    return {
      companyId: 'company-1',
      mediaAssetId: 'asset-1',
      objectKey: 'companies/company-1/assets/image.jpg',
      fileName: 'image.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: content.length,
      content,
    };
  };

  const temporaryUrlInput = (): CreateTemporaryReadUrlInput => ({
    bucket: config.bucket,
    objectKey: 'companies/company-1/assets/image.jpg',
    expiresInSeconds: 300,
  });

  const deleteInput = (): DeleteMediaObjectInput => ({
    bucket: config.bucket,
    objectKey: 'companies/company-1/assets/image.jpg',
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();
    saveMock.mockResolvedValue(undefined);
    getSignedUrlMock.mockResolvedValue([signedUrl]);
    deleteMock.mockResolvedValue(undefined);
    adapter = new FirebaseMediaStorageAdapter(
      bucket,
      config,
      new MediaObjectKeyPolicy(),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('faz upload válido com precondition e metadata corretas', async () => {
    const input = uploadInput();

    await expect(adapter.uploadObject(input)).resolves.toEqual({
      storageProvider: 'FIREBASE',
      bucket: config.bucket,
      objectKey: input.objectKey,
      sizeBytes: input.sizeBytes,
    });
    expect(fileMock).toHaveBeenCalledWith(input.objectKey);
    expect(saveMock).toHaveBeenCalledWith(input.content, {
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
  });

  it('rejeita sizeBytes diferente de content.length', async () => {
    const input = uploadInput();

    await expect(
      adapter.uploadObject({ ...input, sizeBytes: input.sizeBytes + 1 }),
    ).rejects.toThrow('Media content size does not match declared size');
    expect(fileMock).not.toHaveBeenCalled();
  });

  it('rejeita sizeBytes igual a zero', async () => {
    await expect(
      adapter.uploadObject({ ...uploadInput(), sizeBytes: 0 }),
    ).rejects.toThrow('Media content size does not match declared size');
    expect(fileMock).not.toHaveBeenCalled();
  });

  it('rejeita sizeBytes negativo sem tentar upload ou expor o conteúdo', async () => {
    const input = uploadInput();

    try {
      await adapter.uploadObject({ ...input, sizeBytes: -1 });
      throw new Error('Expected negative sizeBytes to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(FirebaseMediaStorageError);
      expect((error as Error).message).toBe(
        'Media content size does not match declared size',
      );
      expect((error as Error).message).not.toContain(input.content.toString());
    }

    expect(fileMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('rejeita Buffer vazio', async () => {
    await expect(
      adapter.uploadObject({
        ...uploadInput(),
        sizeBytes: 1,
        content: Buffer.alloc(0),
      }),
    ).rejects.toThrow('Media content size does not match declared size');
    expect(fileMock).not.toHaveBeenCalled();
  });

  it('rejeita prefixo de outro tenant', async () => {
    await expect(
      adapter.uploadObject({
        ...uploadInput(),
        objectKey: 'companies/company-2/assets/image.jpg',
      }),
    ).rejects.toThrow('Media object key is invalid');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('rejeita caminho com segmento ..', async () => {
    await expect(
      adapter.uploadObject({
        ...uploadInput(),
        objectKey: 'companies/company-1/../image.jpg',
      }),
    ).rejects.toThrow('Media object key is invalid');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('rejeita URL completa como objectKey', async () => {
    await expect(
      adapter.uploadObject({
        ...uploadInput(),
        objectKey: 'https://storage.example.com/image.jpg',
      }),
    ).rejects.toThrow('Media object key is invalid');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('não sobrescreve objeto existente', async () => {
    saveMock.mockRejectedValue({ code: 412 });

    await expect(adapter.uploadObject(uploadInput())).rejects.toEqual(
      expect.objectContaining<FirebaseMediaStorageError>({
        message: 'Media object already exists',
      }),
    );
  });

  it('gera URL assinada V4 somente para leitura', async () => {
    const input = temporaryUrlInput();
    const expiresAt = new Date('2026-08-06T12:05:00.000Z');

    await expect(adapter.createTemporaryReadUrl(input)).resolves.toEqual({
      url: signedUrl,
      expiresAt,
    });
    expect(fileMock).toHaveBeenCalledWith(input.objectKey);
    expect(getSignedUrlMock).toHaveBeenCalledWith({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });
  });

  it.each([59, 3_601])(
    'rejeita duração insegura de %s segundos',
    async (expiresInSeconds) => {
      await expect(
        adapter.createTemporaryReadUrl({
          ...temporaryUrlInput(),
          expiresInSeconds,
        }),
      ).rejects.toThrow('Temporary media URL expiration is invalid');
      expect(getSignedUrlMock).not.toHaveBeenCalled();
    },
  );

  it('rejeita bucket diferente ao gerar URL', async () => {
    await expect(
      adapter.createTemporaryReadUrl({
        ...temporaryUrlInput(),
        bucket: 'other-bucket.example',
      }),
    ).rejects.toThrow('Media storage bucket is not allowed');
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('rejeita objectKey inválido ao gerar URL', async () => {
    await expect(
      adapter.createTemporaryReadUrl({
        ...temporaryUrlInput(),
        objectKey: '../image.jpg',
      }),
    ).rejects.toThrow('Media object key is invalid');
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('exclui somente a chave exata', async () => {
    const input = deleteInput();

    await expect(adapter.deleteObject(input)).resolves.toEqual({
      bucket: config.bucket,
      objectKey: input.objectKey,
      deletedAt: now,
    });
    expect(fileMock).toHaveBeenCalledWith(input.objectKey);
    expect(deleteMock).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('rejeita bucket diferente na exclusão', async () => {
    await expect(
      adapter.deleteObject({
        ...deleteInput(),
        bucket: 'other-bucket.example',
      }),
    ).rejects.toThrow('Media storage bucket is not allowed');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('rejeita objectKey inválido na exclusão', async () => {
    await expect(
      adapter.deleteObject({
        ...deleteInput(),
        objectKey: 'folder//image.jpg',
      }),
    ).rejects.toThrow('Media object key is invalid');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('trata objeto inexistente de forma idempotente', async () => {
    deleteMock.mockResolvedValue(undefined);

    await expect(adapter.deleteObject(deleteInput())).resolves.toEqual(
      expect.objectContaining({ deletedAt: now }),
    );
    expect(deleteMock).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('não mascara outros erros de exclusão', async () => {
    const storageError = new Error('Storage unavailable');
    deleteMock.mockRejectedValue(storageError);

    await expect(adapter.deleteObject(deleteInput())).rejects.toBe(
      storageError,
    );
  });
});
