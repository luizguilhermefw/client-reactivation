import { Module } from '@nestjs/common';
import { MessageProviderModule } from '../message-provider/message-provider.module';
import { MediaStorageModule } from '../media-storage/media-storage.module';
import { MessageWorkerService } from './message-worker.service';
import { QueueService } from './queue.service';
import {
  EnvQueueWorkerConfig,
  QUEUE_WORKER_CONFIG,
} from './queue-worker.config';

@Module({
  imports: [MessageProviderModule, MediaStorageModule],
  providers: [
    QueueService,
    EnvQueueWorkerConfig,
    {
      provide: QUEUE_WORKER_CONFIG,
      useExisting: EnvQueueWorkerConfig,
    },
    MessageWorkerService,
  ],
  exports: [QueueService],
})
export class QueueModule {}
