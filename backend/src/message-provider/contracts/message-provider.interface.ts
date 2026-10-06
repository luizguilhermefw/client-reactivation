import {
  SendImageMessageInput,
  SendMessageResult,
  SendTextMessageInput,
  SendTemplateMessageInput,
} from './message-provider.types';

export interface MessageProvider {
  sendText(input: SendTextMessageInput): Promise<SendMessageResult>;
  sendImage(input: SendImageMessageInput): Promise<SendMessageResult>;
  sendTemplate(input: SendTemplateMessageInput): Promise<SendMessageResult>;
}
