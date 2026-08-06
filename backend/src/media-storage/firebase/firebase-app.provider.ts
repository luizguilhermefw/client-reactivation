import type { App } from 'firebase-admin/app';
import {
  applicationDefault,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import type { FirebaseStorageBucket } from './firebase-storage-client.interface';
import {
  FirebaseStorageConfig,
  FirebaseStorageConfigurationError,
} from './firebase-storage.config';

export const FIREBASE_MEDIA_APP_NAME = 'aylaflow-media-storage';

export function createFirebaseMediaApp(config: FirebaseStorageConfig): App {
  const existingApp = getApps().find(
    (app) => app.name === FIREBASE_MEDIA_APP_NAME,
  );

  if (existingApp) {
    if (
      existingApp.options.projectId !== config.projectId ||
      existingApp.options.storageBucket !== config.bucket
    ) {
      throw new FirebaseStorageConfigurationError();
    }

    return getApp(FIREBASE_MEDIA_APP_NAME);
  }

  return initializeApp(
    {
      credential: applicationDefault(),
      projectId: config.projectId,
      storageBucket: config.bucket,
    },
    FIREBASE_MEDIA_APP_NAME,
  );
}

export function createFirebaseStorageBucket(
  app: App,
  config: FirebaseStorageConfig,
): FirebaseStorageBucket {
  const bucket = getStorage(app).bucket(config.bucket);

  if (bucket.name !== config.bucket) {
    throw new FirebaseStorageConfigurationError();
  }

  return bucket;
}
