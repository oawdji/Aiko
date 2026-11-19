/**
 * 插件事件总线（Phase 2）。
 *
 * pipeline 在关键节点发布事件，插件（及内置功能）可订阅响应，
 * 无需修改核心代码。约定：
 * - 单个 handler 抛错 → console.warn 并继续，不影响其他 handler 与主流程；
 * - publish 为顺序 await，handler 间有确定顺序；
 * - 事件不落库（审计依赖 prompt 快照与既有表），Phase 3 再考虑事件溯源。
 */

export type AikoEventMap = {
  /** 用户消息已持久化（重新生成复用旧消息时不发布） */
  message_created: {
    conversationId: string;
    agentId: string;
    messageId: string;
    role: 'user';
    content: string;
  };
  /** 情绪状态事件落库并更新 Agent 快照后 */
  state_changed: {
    agentId: string;
    conversationId: string;
    eventId: string;
    tag: string;
    valence: number;
    arousal: number;
    dominance: number;
  };
  /** 会话摘要生成成功（异步任务） */
  summary_ready: { conversationId: string; summaryId: string };
  /** assistant 回复已落库（仅成功分支；失败占位不发布） */
  response_completed: {
    conversationId: string;
    agentId: string;
    messageId: string;
    content: string;
  };
};

export type AikoEventType = keyof AikoEventMap;

type Handler<T> = (payload: T) => void | Promise<void>;

const handlers = new Map<AikoEventType, Set<Handler<never>>>();

export function subscribe<K extends AikoEventType>(
  type: K,
  handler: Handler<AikoEventMap[K]>,
): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler as Handler<never>);
  return () => {
    set!.delete(handler as Handler<never>);
  };
}

export async function publishEvent<K extends AikoEventType>(
  type: K,
  payload: AikoEventMap[K],
): Promise<void> {
  const set = handlers.get(type);
  if (!set || set.size === 0) return;
  for (const handler of set) {
    try {
      await (handler as Handler<AikoEventMap[K]>)(payload);
    } catch (error) {
      console.warn(
        `[plugins] event handler failed for ${type}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/** 测试辅助：清空（全部或指定类型的）订阅。 */
export function clearEventHandlersForTests(type?: AikoEventType): void {
  if (type) {
    handlers.delete(type);
  } else {
    handlers.clear();
  }
}