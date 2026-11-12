import { useEffect, useRef } from 'react';
import { DEFAULT_AGENT_ID } from '@aiko/shared';
import type { BootstrapResponse } from '@aiko/shared';
import { MessageComposer } from '../chat/components/MessageComposer';
import { MessageList } from '../chat/components/MessageList';
import { useAgentChat } from '../chat/hooks/use-agent-chat';
import { extractStateEvents } from '../chat/utils/extract-state-events';
import { DevChecklist } from './DevChecklist';
import { StatusPanel } from '../status/components/StatusPanel';
import { ErrorNotice } from '../shared/components/ErrorNotice';
import { useServerHealth } from '../shared/hooks/useServerHealth';
import { agentStateStore } from '../shared/stores/agent-state-store';

/**
 * 聊天主视图（M2.5）：
 * - 仅在 bootstrap ready 后挂载，恢复消息一次性注入 useChat；
 * - 流式 data part 事件经 effect 单向写入 AgentStateStore（§633 流程），
 *   store 内部按事件 id 去重，不产生第二套消息存储。
 */
export function ChatView({ bootstrap }: { bootstrap: BootstrapResponse }) {
  const serverStatus = useServerHealth();
  const { messages, sendMessage, status, stop, error } = useAgentChat(
    bootstrap.messages,
  );

  const stateEvents = extractStateEvents(messages);
  const appliedEventIdRef = useRef<string | null>(
    agentStateStore.getState().latestEvent?.id ?? null,
  );

  useEffect(() => {
    const latest = stateEvents.at(-1);
    if (latest && latest.id !== appliedEventIdRef.current) {
      appliedEventIdRef.current = latest.id;
      agentStateStore.applyStateEvent(latest);
    }
  }, [stateEvents]);

  const isBusy = status === 'submitted' || status === 'streaming';

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 bg-neutral-950 p-6 text-neutral-100 lg:flex-row">
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">{bootstrap.agent.displayName}</h1>
          <p className="text-sm text-neutral-400">
            会话已恢复 · {bootstrap.messages.length} 条历史消息
          </p>
          <p className="text-xs text-neutral-500">
            后端：
            {serverStatus === 'checking' && '检测中…'}
            {serverStatus === 'ok' && (
              <span className="text-emerald-400">已连接</span>
            )}
            {serverStatus === 'error' && (
              <span className="text-red-400">未连接</span>
            )}
            {' · '}
            Agent: {DEFAULT_AGENT_ID}
          </p>
        </header>

        <MessageList messages={messages} />

        {status === 'error' && (
          <ErrorNotice
            message={error instanceof Error ? error.message : String(error ?? '未知错误')}
            hint="409 验证：发送包含“409”的消息触发"
          />
        )}

        <MessageComposer
          onSend={(text) => {
            void sendMessage({ text });
          }}
          onStop={stop}
          isBusy={isBusy}
        />
      </section>

      <aside className="w-full shrink-0 space-y-3 lg:w-80">
        <StatusPanel />
        <DevChecklist />
      </aside>
    </main>
  );
}