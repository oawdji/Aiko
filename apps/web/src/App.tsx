import { DEFAULT_AGENT_ID } from '@aiko/shared';
import { MessageComposer } from './chat/components/MessageComposer';
import { MessageList } from './chat/components/MessageList';
import { RESTORED_MESSAGES } from './chat/fixtures/restored-messages';
import { useRestoredChat } from './chat/hooks/useRestoredChat';
import { extractStateEvents } from './chat/utils/extract-state-events';
import { DevChecklist } from './app/DevChecklist';
import { StatusPanel } from './status/components/StatusPanel';
import { ErrorNotice } from './shared/components/ErrorNotice';
import { useServerHealth } from './shared/hooks/useServerHealth';

export default function App() {
  const serverStatus = useServerHealth();

  const { messages, sendMessage, status, stop, error } = useRestoredChat(
    RESTORED_MESSAGES,
  );
  const stateEvents = extractStateEvents(messages);
  const latestEvent = stateEvents.at(-1) ?? null;
  const isBusy = status === 'submitted' || status === 'streaming';

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 bg-neutral-950 p-6 text-neutral-100 lg:flex-row">
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Aiko</h1>
          <p className="text-sm text-neutral-400">
            T0.5 · 冒烟验证（mock，无需 LLM Key）
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
        <StatusPanel latestEvent={latestEvent} receivedCount={stateEvents.length} />
        <DevChecklist />
      </aside>
    </main>
  );
}