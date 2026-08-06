import { Module } from '@nestjs/common';
import { MEDIA_STORAGE_ADAPTER } from './media-storage-adapter.token';
import {
  createFirebaseMediaApp,
  createFirebaseStorageBucket,
} from './firebase/firebase-app.provider';
import { FirebaseMediaStorageAdapter } from './firebase/firebase-media-storage.adapter';
import { resolveFirebaseStorageConfig } from './firebase/firebase-storage.config';
import {
  FIREBASE_MEDIA_APP,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_STORAGE_CONFIG,
} from './firebase/firebase-storage.tokens';
import { MediaObjectKeyPolicy } from './firebase/media-object-key.policy';

@Module({
  providers: [
    {
      provide: FIREBASE_STORAGE_CONFIG,
      useFactory: resolveFirebaseStorageConfig,
    },
    {
      provide: FIREBASE_MEDIA_APP,
      useFactory: createFirebaseMediaApp,
      inject: [FIREBASE_STORAGE_CONFIG],
    },
    {
      provide: FIREBASE_STORAGE_BUCKET,
      useFactory: createFirebaseStorageBucket,
      inject: [FIREBASE_MEDIA_APP, FIREBASE_STORAGE_CONFIG],
    },
    MediaObjectKeyPolicy,
    FirebaseMediaStorageAdapter,
    {
      provide: MEDIA_STORAGE_ADAPTER,
      useExisting: FirebaseMediaStorageAdapter,
    },
  ],
  exports: [MEDIA_STORAGE_ADAPTER],
})
export class MediaStorageModule {}
