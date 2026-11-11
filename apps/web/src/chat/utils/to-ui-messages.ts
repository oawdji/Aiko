import type { UIMessage } from 'ai';
import type { ChatMessageDTO } from '@aiko/shared';

export function toUiMessages(messages: ChatMessageDTO[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: 'text' as const, text: message.content }],
  }));
}