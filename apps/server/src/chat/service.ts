import type { ChatRequestBody } from '@aiko/shared';

export type ChatServiceDeps = {
  body: ChatRequestBody;
};

/**
 * M3.1 校验桩：真正的编排（写用户消息 → 情绪规则 → LLM 流式 → 落库）
 * 在 M3.2/M3.4 落地；本函数签名即 service 层入口，route 层不感知内部实现。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 参数在 M3.2 实装
export async function handleChatRequest(_deps: ChatServiceDeps): Promise<never> {
  throw new Error('chat pipeline not implemented yet (M3.2/M3.4)');
}