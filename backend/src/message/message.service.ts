import { Injectable } from '@nestjs/common';
import { WhatsappProvider } from './providers/whatsapp.provider';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class MessageService {
  constructor(private readonly provider: WhatsappProvider) {}

  async sendMessage(data: SendMessageDto) {
    return this.provider.send(data);
  }
}