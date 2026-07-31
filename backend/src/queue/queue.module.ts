import { Module } from '@nestjs/common';
import { MessageWorkerService } from './message-worker.service';
import { QueueService } from './queue.service';

@Module({
  providers: [QueueService, MessageWorkerService],
  exports: [QueueService],
})
export class QueueModule {}
