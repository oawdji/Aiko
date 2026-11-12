import type { ChatRequestBody } from '@aiko/shared';
import type { AppUIMessage } from '../types';

/**
 * AI SDK UIMessage 流 → 契约 ChatRequestBody（api-contract.md §13.1）：
 * - message = 最后一条 user 消息的全部 text part 拼接；
 * - clientMessageId = 该消息的 AI SDK id（同一条消息稳定，天然满足 §14 幂等重试语义：
 *   重发/重试同一消息会命中 409 DUPLICATE_CLIENT_MESSAGE，不会产生第二条记录）。
 */
export function buildChatRequestBody(params: {
  conversationId: string;
  agentId: string;
  messages: AppUIMessage[];
}): ChatRequestBody {
  const lastUserMessage = [...params.messages]
    .reverse()
    .find((message) => message.role === 'user');

  const text = (lastUserMessage?.parts ?? [])
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');

  return {
    agentId: params.agentId,
    conversationId: params.conversationId,
    message: text,
    clientMessageId: lastUserMessage?.id ?? crypto.randomUUID(),
  };
}