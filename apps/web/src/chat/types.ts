import type { UIMessage } from 'ai';
import type { AgentStateEventData } from '@aiko/shared';

/**
 * 参数化自定义数据 part 后的 UI 消息类型。
 * 消除对 message.parts 的 as never 强转，让
 * data-agent-state-event 拥有完整类型。
 */
export type AppUIMessage = UIMessage<
  unknown,
  { 'agent-state-event': AgentStateEventData }
>;