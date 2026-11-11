import { useEffect, useState } from 'react';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import type { ChatMessageDTO } from '@aiko/shared';
import { useRestoredChat } from './chat/hooks/useRestoredChat';

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

  const { messages, sendMessage, status } = useRestoredChat(RESTORED_MESSAGES);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setServerStatus(res.ok ? 'ok' : 'error'))
      .catch(() => setServerStatus('error'));
  }, []);

  const send = () => {
    const text = input.trim();
    if (!text || status === 'submitted' || status === 'streaming') return;
    setInput('');
    sendMessage({ text });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 bg-neutral-950 p-6 text-neutral-100">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold">Aiko</h1>
        <p className="text-sm text-neutral-400">
          T0.4 · useChat 恢复注入验证 · mock 流式（无需 LLM Key）
        </p>
        <p className="text-xs text-neutral-500">
          后端：
          {serverStatus === 'checking' && '检测中…'}
          {serverStatus === 'ok' && <span className="text-emerald-400">已连接</span>}
          {serverStatus === 'error' && <span className="text-red-400">未连接</span>}
          {' · '}
          Agent: {DEFAULT_AGENT_ID} · User: {LOCAL_USER_ID}
        </p>
      </header>

      <section
        aria-label="消息列表"
        className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 p-4"
      >
        <p className="text-xs text-neutral-500">
          —— 以下 3 条为注入的恢复消息（若可见即注入成功）——
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
                part.type === 'text' ? <span key={index}>{part.text}</span> : null,
              )}
            </div>
          </div>
        ))}
        <p className="text-xs text-neutral-500">
          —— 以上之后的是本轮发送的流式回复 ——
        </p>
      </section>

      <footer className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              send();
            }
          }}
          placeholder="输入消息，Enter 发送（回复来自 mock 端点）"
          className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-sky-600"
        />
        <button
          type="button"
          onClick={send}
          disabled={
            !input.trim() || status === 'submitted' || status === 'streaming'
          }
          className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-sky-600"
        >
          {status === 'submitted' || status === 'streaming' ? '生成中…' : '发送'}
        </button>
      </footer>
    </main>
  );
}