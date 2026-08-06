jest.mock('firebase-admin/app', () => ({
  applicationDefault: jest.fn(),
  getApp: jest.fn(),
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));

jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn(),
}));

import type { App, Credential } from 'firebase-admin/app';
import {
  applicationDefault,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import {
  createFirebaseMediaApp,
  createFirebaseStorageBucket,
  FIREBASE_MEDIA_APP_NAME,
} from './firebase-app.provider';
import {
  FirebaseStorageConfigurationError,
  resolveFirebaseStorageConfig,
} from './firebase-storage.config';

describe('Firebase Admin media initialization', () => {
  const config = {
    projectId: 'test-project',
    bucket: 'test-project.firebasestorage.app',
  };
  const applicationDefaultMock = jest.mocked(applicationDefault);
  const getAppMock = jest.mocked(getApp);
  const getAppsMock = jest.mocked(getApps);
  const initializeAppMock = jest.mocked(initializeApp);
  const getStorageMock = jest.mocked(getStorage);

  beforeEach(() => {
    jest.clearAllMocks();
    getAppsMock.mockReturnValue([]);
  });

  it.each([
    [undefined, config.bucket],
    [config.projectId, undefined],
    ['', config.bucket],
    [config.projectId, ''],
  ])('rejeita variáveis obrigatórias ausentes', (projectId, bucket) => {
    expect(() =>
      resolveFirebaseStorageConfig((key) =>
        key === 'FIREBASE_STORAGE_PROJECT_ID' ? projectId : bucket,
      ),
    ).toThrow(FirebaseStorageConfigurationError);
  });

  it('inicializa app nomeado com Application Default Credentials', () => {
    const credential = {} as Credential;
    const app = { name: FIREBASE_MEDIA_APP_NAME } as App;
    applicationDefaultMock.mockReturnValue(credential);
    initializeAppMock.mockReturnValue(app);

    expect(createFirebaseMediaApp(config)).toBe(app);
    expect(applicationDefaultMock).toHaveBeenCalledTimes(1);
    expect(initializeAppMock).toHaveBeenCalledWith(
      {
        credential,
        projectId: config.projectId,
        storageBucket: config.bucket,
      },
      FIREBASE_MEDIA_APP_NAME,
    );
  });

  it('reutiliza app nomeado já inicializado', () => {
    const app = {
      name: FIREBASE_MEDIA_APP_NAME,
      options: {
        projectId: config.projectId,
        storageBucket: config.bucket,
      },
    } as App;
    getAppsMock.mockReturnValue([app]);
    getAppMock.mockReturnValue(app);

    expect(createFirebaseMediaApp(config)).toBe(app);
    expect(getAppMock).toHaveBeenCalledWith(FIREBASE_MEDIA_APP_NAME);
    expect(applicationDefaultMock).not.toHaveBeenCalled();
    expect(initializeAppMock).not.toHaveBeenCalled();
  });

  it('não reutiliza app nomeado com configuração divergente', () => {
    const app = {
      name: FIREBASE_MEDIA_APP_NAME,
      options: {
        projectId: 'other-project',
        storageBucket: config.bucket,
      },
    } as App;
    getAppsMock.mockReturnValue([app]);

    expect(() => createFirebaseMediaApp(config)).toThrow(
      FirebaseStorageConfigurationError,
    );
    expect(getAppMock).not.toHaveBeenCalled();
    expect(applicationDefaultMock).not.toHaveBeenCalled();
  });

  it('obtém somente o bucket configurado para o app nomeado', () => {
    const app = { name: FIREBASE_MEDIA_APP_NAME } as App;
    const bucket = { name: config.bucket, file: jest.fn() };
    const bucketMock = jest.fn().mockReturnValue(bucket);
    getStorageMock.mockReturnValue({ bucket: bucketMock } as ReturnType<
      typeof getStorage
    >);

    expect(createFirebaseStorageBucket(app, config)).toBe(bucket);
    expect(getStorageMock).toHaveBeenCalledWith(app);
    expect(bucketMock).toHaveBeenCalledWith(config.bucket);
  });

  it('rejeita bucket retornado com nome divergente', () => {
    const app = { name: FIREBASE_MEDIA_APP_NAME } as App;
    const bucketMock = jest.fn().mockReturnValue({
      name: 'other-bucket.example',
      file: jest.fn(),
    });
    getStorageMock.mockReturnValue({ bucket: bucketMock } as ReturnType<
      typeof getStorage
    >);

    expect(() => createFirebaseStorageBucket(app, config)).toThrow(
      FirebaseStorageConfigurationError,
    );
  });

  it('não expõe caminho de credencial em erro de configuração', () => {
    const credentialPath = 'C:\\private\\service-account.json';
    const originalCredentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const originalProjectId = process.env.FIREBASE_STORAGE_PROJECT_ID;
    const originalBucket = process.env.FIREBASE_STORAGE_BUCKET;

    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
    delete process.env.FIREBASE_STORAGE_PROJECT_ID;
    delete process.env.FIREBASE_STORAGE_BUCKET;

    try {
      resolveFirebaseStorageConfig();
      throw new Error('Expected Firebase configuration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(FirebaseStorageConfigurationError);
      expect((error as Error).message).not.toContain(credentialPath);
      expect((error as Error).message).not.toContain('private key');
    } finally {
      restoreEnvironment(
        'GOOGLE_APPLICATION_CREDENTIALS',
        originalCredentialPath,
      );
      restoreEnvironment('FIREBASE_STORAGE_PROJECT_ID', originalProjectId);
      restoreEnvironment('FIREBASE_STORAGE_BUCKET', originalBucket);
    }
  });

  function restoreEnvironment(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  }
});
