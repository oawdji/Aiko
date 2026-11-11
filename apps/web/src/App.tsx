import { useEffect, useState } from 'react';
import { DEFAULT_AGENT_ID } from '@aiko/shared';
import type { ChatMessageDTO } from '@aiko/shared';
import { useRestoredChat } from './chat/hooks/useRestoredChat';
import { extractStateEvents } from './chat/utils/extract-state-events';

const RESTORED_MESSAGES: ChatMessageDTO[] = [
  {
    id: 'msg_demo_0001',
    conversationId: 'conv_demo',
    agentId: DEFAULT_AGENT_ID,
    role: 'user',
    content: '你好，还记得昨天聊到我在学做饭吗？',
    status: 'complete',
    errorCode: null,
    createdAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'msg_demo_0002',
    conversationId: 'conv_demo',
    agentId: DEFAULT_AGENT_ID,
    role: 'assistant',
    content: '记得呀，你说想先从家常菜开始，这周打算试试番茄炒蛋。',
    status: 'complete',
    errorCode: null,
    createdAt: '2026-11-10T08:00:05.000Z',
  },
  {
    id: 'msg_demo_0003',
    conversationId: 'conv_demo',
    agentId: DEFAULT_AGENT_ID,
    role: 'user',
    content: '对，今天想聊聊别的。',
    status: 'complete',
    errorCode: null,
    createdAt: '2026-11-10T08:01:00.000Z',
  },
];

type ServerStatus = 'checking' | 'ok' | 'error';

const roleLabel: Record<string, string> = {
  user: '你',
  assistant: 'Aiko',
  system: '系统',
};

export default function App() {
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const [input, setInput] = useState('');

  const { messages, sendMessage, status, stop, error } = useRestoredChat(
    RESTORED_MESSAGES,
  );
  const stateEvents = extractStateEvents(messages);
  const latestEvent = stateEvents.at(-1) ?? null;
  const isBusy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setServerStatus(res.ok ? 'ok' : 'error'))
      .catch(() => setServerStatus('error'));
  }, []);

  const send = () => {
    const text = input.trim();
    if (!text || isBusy) return;
    setInput('');
    sendMessage({ text });
  };

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
          </p>
        </header>

        <div
          aria-label="消息列表"
          className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 p-4"
        >
          <p className="text-xs text-neutral-500">
            —— 以下 3 条为注入的恢复消息 ——
          </p>
          {messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === 'user'
                  ? 'ml-auto max-w-[80%] rounded-xl bg-sky-900/60 px-3 py-2'
                  : 'mr-auto max-w-[80%] rounded-xl bg-neutral-800 px-3 py-2'
              }
            >
              <div className="mb-0.5 text-xs text-neutral-400">
                {roleLabel[message.role] ?? message.role}
              </div>
              <div className="text-sm whitespace-pre-wrap">
                {message.parts.map((part, index) =>
                  part.type === 'text' ? (
                    <span key={index}>{part.text}</span>
                  ) : null,
                )}
              </div>
            </div>
          ))}
        </div>

        {status === 'error' && (
          <div className="rounded-xl border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            请求失败：
            {error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : '未知错误'}
            （409 验证：发送包含“409”的消息触发）
          </div>
        )}

        <footer className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                send();
              }
            }}
            placeholder="试试：我刚才说了什么？（含“409”可测冲突）"
            className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-sky-600"
          />
          <button
            type="button"
            onClick={send}
            disabled={!input.trim() || isBusy}
            className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-sky-600"
          >
            {isBusy ? '生成中…' : '发送'}
          </button>
          {isBusy && (
            <button
              type="button"
              onClick={() => stop()}
              className="rounded-xl bg-neutral-700 px-4 py-2 text-sm font-medium hover:bg-neutral-600"
            >
              停止
            </button>
          )}
        </footer>
      </section>

      <aside className="w-full shrink-0 space-y-3 lg:w-80">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-2 text-sm font-semibold">状态事件（data part）</h2>
          {latestEvent ? (
            <div className="space-y-1 text-xs text-neutral-300">
              <p>
                valence:{' '}
                <span className="text-sky-400">
                  {latestEvent.after.valence.toFixed(2)}
                </span>{' '}
                / arousal:{' '}
                <span className="text-amber-400">
                  {latestEvent.after.arousal.toFixed(2)}
                </span>{' '}
                / tag: <span className="text-emerald-400">{latestEvent.discreteTag}</span>
              </p>
              <p className="text-neutral-400">原因：{latestEvent.reason}</p>
              <p className="text-neutral-500">
                事件流顺序验证：状态事件应先于文本增量到达（共收到{' '}
                {stateEvents.length} 个事件）
              </p>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">尚未收到状态事件。</p>
          )}
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-2 text-sm font-semibold">验证清单</h2>
          <ul className="list-inside list-disc space-y-1 text-xs text-neutral-400">
            <li>恢复消息渲染（T0.4）</li>
            <li>发送后流式文本逐块出现</li>
            <li>状态面板先于文本更新</li>
            <li>发送含“409”的消息 → 展示错误</li>`n            <li>多轮上下文：问“我刚才说了什么？”</li>
            <li>生成中点击“停止” → 中断流</li>
          </ul>
        </div>
      </aside>
    </main>
  );
}