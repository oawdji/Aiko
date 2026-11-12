import { useEffect, useState } from 'react';

export type ServerStatus = 'checking' | 'ok' | 'error';

/**
 * Phase 0 过渡实现：组件不直接 fetch 的临时归所。
 * M2 将统一迁移到 src/api/client.ts 的 fetchBootstrap 领域函数。
 */
export function useServerHealth(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setStatus(res.ok ? 'ok' : 'error'))
      .catch(() => setStatus('error'));
  }, []);

  return status;
}