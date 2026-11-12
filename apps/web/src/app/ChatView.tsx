import { useEffect, useRef, useState } from 'react';
import { DEFAULT_AGENT_ID } from '@aiko/shared';
import type { BootstrapResponse, SettingsResponse } from '@aiko/shared';
import { MessageComposer } from '../chat/components/MessageComposer';
import { MessageList } from '../chat/components/MessageList';
import { useAgentChat } from '../chat/hooks/use-agent-chat';
import { extractStateEvents } from '../chat/utils/extract-state-events';
import { DevChecklist } from './DevChecklist';
import { SettingsDialog } from '../settings/components/SettingsDialog';
import { fetchSettings } from '../shared/api/settings-api';
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

  const [llmSettings, setLlmSettings] = useState<SettingsResponse | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((data) => {
        if (!cancelled) setLlmSettings(data);
      })
      .catch(() => {
        // 设置读取失败不阻塞聊天，弹窗内可重试
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const llmConfigured = llmSettings?.llm.apiKeyConfigured ?? true;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 bg-neutral-950 p-6 text-neutral-100 lg:flex-row">
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="relative space-y-1 text-center">
          <h1 className="text-2xl font-semibold">{bootstrap.agent.displayName}</h1>
          <p className="text-sm text-neutral-400">
            会话已恢复 · {bootstrap.messages.length} 条历史消息
          </p>
          <button
            type="button"
            aria-label="打开设置"
            onClick={() => setSettingsOpen(true)}
            className="absolute right-2 top-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            ⚙ 设置
          </button>
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

        {!llmConfigured && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-2 text-xs text-amber-300">
            <span>尚未配置 LLM API Key，发送消息前请先完成设置。</span>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="shrink-0 rounded-md bg-amber-600 px-3 py-1 font-medium text-neutral-950 hover:bg-amber-500"
            >
              去设置
            </button>
          </div>
        )}

        <MessageList messages={messages} />

        {status === 'error' && (
          <ErrorNotice
            message={error instanceof Error ? error.message : String(error ?? '未知错误')}
            hint={/DUPLICATE_CLIENT_MESSAGE/.test(error?.message ?? String(error)) ? "消息重复：已从服务端刷新会话，请勿重发同一内容" : "请检查本地服务与 LLM 配置后重试"}
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

      <SettingsDialog
        open={settingsOpen}
        settings={llmSettings}
        onSaved={(data) => setLlmSettings(data)}
        onClose={() => setSettingsOpen(false)}
      />

      <aside className="w-full shrink-0 space-y-3 lg:w-80">
        <StatusPanel />
        <DevChecklist />
      </aside>
    </main>
  );
}