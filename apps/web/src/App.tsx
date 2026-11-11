import { useEffect, useState } from 'react';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';

type ServerStatus = 'checking' | 'ok' | 'error';

export default function App() {
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setServerStatus(res.ok ? 'ok' : 'error'))
      .catch(() => setServerStatus('error'));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Aiko</h1>
        <p className="text-sm text-neutral-400">
          Phase 0 · 工程骨架 · Agent: {DEFAULT_AGENT_ID} · User: {LOCAL_USER_ID}
        </p>
        <p className="text-sm">
          后端状态：
          {serverStatus === 'checking' && (
            <span className="text-neutral-400">检测中…</span>
          )}
          {serverStatus === 'ok' && <span className="text-emerald-400">已连接</span>}
          {serverStatus === 'error' && <span className="text-red-400">未连接</span>}
        </p>
      </div>
    </main>
  );
}