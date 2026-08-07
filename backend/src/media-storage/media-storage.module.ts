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
import { MediaAssetController } from './media-asset.controller';
import {
  EnvMediaReadUrlConfig,
  MEDIA_READ_URL_CONFIG,
} from './media-read-url.config';
import { MediaMessageResolver } from './media-message.resolver';

@Module({
  imports: [PrismaModule],
  controllers: [MediaAssetController],
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
    {
      provide: MEDIA_READ_URL_CONFIG,
      useFactory: () => new EnvMediaReadUrlConfig(),
    },
    FirebaseMediaStorageAdapter,
    {
      provide: MEDIA_STORAGE_ADAPTER,
      useExisting: FirebaseMediaStorageAdapter,
    },
    MediaAssetService,
    MediaMessageResolver,
  ],
  exports: [MEDIA_STORAGE_ADAPTER, MediaAssetService, MediaMessageResolver],
})
export class MediaStorageModule {}
