import { DEFAULT_AGENT_SLUG } from '@aiko/shared';
import { ChatView } from './app/ChatView';
import { useBootstrap } from './app/use-bootstrap';

/**
 * App 只做启动状态机渲染（react-architecture.md §10.3）：
 * loading → 全页加载；error → 全页错误（无聊天输入框）；ready → ChatView。
 * 聊天与状态面板的全部细节下沉到 ChatView 与 store。
 */
export default function App() {
  const boot = useBootstrap();

  if (boot.status === 'loading') {
    return (
      <main
        aria-label="启动中"
        className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-300"
      >
        <div className="flex flex-col items-center gap-3">
          <div
            aria-hidden
            className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-sky-400"
          />
          <p className="text-sm">正在恢复会话…</p>
        </div>
      </main>
    );
  }

  if (boot.status === 'error') {
    return (
      <main
        aria-label="启动失败"
        className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-200"
      >
        <div className="w-full max-w-md space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center">
          <h1 className="text-lg font-semibold">会话恢复失败</h1>
          <p className="text-xs text-neutral-500">错误码：{boot.errorCode}</p>
          <p className="text-sm text-neutral-400">
            没有恢复会话前无法安全发送消息。
          </p>
          <button
            type="button"
            onClick={boot.retry}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-sky-400"
          >
            重试
          </button>
          <p className="text-xs text-neutral-600">
            Agent: {DEFAULT_AGENT_SLUG} · 请确认本地服务已启动（127.0.0.1:8787）
          </p>
        </div>
      </main>
    );
  }

  return <ChatView bootstrap={boot.data} />;
}