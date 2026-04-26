export type MessageType = 'text' | 'image' | 'video' | 'audio';

export interface SendMessageDto {
  to: string;
  type: MessageType;
  content: string;
  mediaUrl?: string;
}