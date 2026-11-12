import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMemo, useRef } from 'react';
import type { ChatMessageDTO } from '@aiko/shared';
import type { AppUIMessage } from '../types';
import { toUiMessages } from '../utils/to-ui-messages';

/**
 * T0.4 验证 hook：
 * 1. bootstrap 恢复的 ChatMessageDTO 转换为 UIMessage 后注入 useChat 初始状态；
 * 2. transport 与初始消息引用保持稳定，不随渲染重建；
 * 3. Phase 0 阶段指向 /api/dev/mock-chat，无需 LLM Key（M2 起由真实 API 替代）。
 */
export function useRestoredChat(restoredMessages: ChatMessageDTO[]) {
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