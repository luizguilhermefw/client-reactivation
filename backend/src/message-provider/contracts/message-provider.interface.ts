import {
  SendImageMessageInput,
  SendMessageResult,
  SendTextMessageInput,
} from './message-provider.types';

export interface MessageProvider {
  sendText(input: SendTextMessageInput): Promise<SendMessageResult>;
  sendImage(input: SendImageMessageInput): Promise<SendMessageResult>;
}
