import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMemo, useRef } from 'react';
import type { ChatMessageDTO } from '@aiko/shared';
import type { AppUIMessage } from '../types';
import { toUiMessages } from '../utils/to-ui-messages';

/**
 * 聊天主 hook（原 T0.4 useRestoredChat，M2.6 更名）：
 * 1. bootstrap 恢复的 ChatMessageDTO 转为 UIMessage 后一次性注入 useChat 初始状态；
 * 2. transport 与初始消息引用保持稳定，不随渲染重建；
 * 3. 传输端点当前仍为 dev mock（/api/dev/mock-chat，无 LLM Key 即可联调）；
 *    M3 实现服务端 /api/chat 后切换 api 参数即可，本 hook 不再改动。
 */
export function useAgentChat(restoredMessages: ChatMessageDTO[]) {
  const transportRef = useRef(
    new DefaultChatTransport<AppUIMessage>({ api: '/api/dev/mock-chat' }),
  );

  const initialMessages = useMemo(
    () => toUiMessages(restoredMessages),
    // 初始消息只应注入一次；restoredMessages 由调用方保持稳定引用
    [],
  );

  return useChat<AppUIMessage>({
    transport: transportRef.current,
    messages: initialMessages,
  });
}