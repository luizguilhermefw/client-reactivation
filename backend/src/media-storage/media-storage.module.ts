import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MediaAssetService } from './media-asset.service';
import { MEDIA_STORAGE_ADAPTER } from './media-storage-adapter.token';
import { MediaObjectKeyFactory } from './media-object-key.factory';
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
  imports: [PrismaModule],
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
    MediaObjectKeyFactory,
    FirebaseMediaStorageAdapter,
    {
      provide: MEDIA_STORAGE_ADAPTER,
      useExisting: FirebaseMediaStorageAdapter,
    },
    MediaAssetService,
  ],
  exports: [MEDIA_STORAGE_ADAPTER, MediaAssetService],
})
export class MediaStorageModule {}
