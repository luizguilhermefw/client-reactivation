import { Module } from '@nestjs/common';
import { MessageProviderModule } from '../message-provider/message-provider.module';
import { MessageWorkerService } from './message-worker.service';
import { QueueService } from './queue.service';

@Module({
  imports: [MessageProviderModule],
  providers: [QueueService, MessageWorkerService],
  exports: [QueueService],
})
export class QueueModule {}
