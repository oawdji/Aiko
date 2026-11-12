import { useEffect, useState } from 'react';
import { fetchHealth } from '../api/chat-recovery';

export type ServerStatus = 'checking' | 'ok' | 'error';

/** 服务健康探测：组件侧只经由领域函数 fetchHealth 访问 API（M2.4）。 */
export function useServerHealth(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth({ signal: controller.signal })
      .then(() => setStatus('ok'))
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, []);

  return status;
}