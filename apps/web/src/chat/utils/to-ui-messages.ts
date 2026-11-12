import type { ChatMessageDTO } from '@aiko/shared';
import type { AppUIMessage } from '../types';

export function toUiMessages(messages: ChatMessageDTO[]): AppUIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: 'text' as const, text: message.content }],
  }));
}