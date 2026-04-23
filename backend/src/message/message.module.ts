import { Module } from '@nestjs/common';
import { MessageService } from './message.service';
import { WhatsappProvider } from './providers/whatsapp.provider';

@Module({
  providers: [MessageService, WhatsappProvider],
  exports: [MessageService], // 👈 MUITO IMPORTANTE
})
export class MessageModule {}