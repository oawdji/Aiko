import type { ChatMessageDTO } from '@aiko/shared';
import type { AppUIMessage } from '../types';

export function toUiMessages(messages: ChatMessageDTO[]): AppUIMessage[] {
  // 重新生成后旧回复被标记为 failed / SUPERSEDED，对用户不可见
  const visible = messages.filter(
    (message) => !(message.status === 'failed' && message.errorCode === 'SUPERSEDED'),
  );
  return visible.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: 'text' as const, text: message.content }],
  }));
}