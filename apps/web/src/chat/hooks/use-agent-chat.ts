import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMemo, useRef } from 'react';
import type { ChatMessageDTO } from '@aiko/shared';
import { fetchConversation } from '../../shared/api/chat-recovery';
import type { AppUIMessage } from '../types';
import { toUiMessages } from '../utils/to-ui-messages';

/**
 * 聊天主 hook（M3.6 接入真实 POST /api/chat）：
 * 1. bootstrap 恢复的 ChatMessageDTO 转为 UIMessage 后一次性注入 useChat 初始状态；
 * 2. transport 与初始消息引用保持稳定，不随渲染重建；
 * 3. 409 DUPLICATE_CLIENT_MESSAGE → 按 §14.4 调 GET /api/conversations/:id 刷新消息列表，
 *    不重试同一 clientMessageId；
 * 4. 组件不得直接 fetch，刷新经由 shared/api 领域函数完成。
 */
export function useAgentChat(restoredMessages: ChatMessageDTO[]) {
  const transportRef = useRef(
    new DefaultChatTransport<AppUIMessage>({ api: '/api/chat' }),
  );

  const initialMessages = useMemo(
    () => toUiMessages(restoredMessages),
    // 初始消息只应注入一次；restoredMessages 由调用方保持稳定引用
    [],
  );

  const chat = useChat<AppUIMessage>({
    transport: transportRef.current,
    messages: initialMessages,
    onError: (error) => {
      if (!/DUPLICATE_CLIENT_MESSAGE/.test(error.message)) return;
      const conversationId = restoredMessages[0]?.conversationId;
      if (!conversationId) return;
      void fetchConversation(conversationId).then((detail) => {
        chat.setMessages(toUiMessages(detail.messages));
      });
    },
  });

  return chat;
}