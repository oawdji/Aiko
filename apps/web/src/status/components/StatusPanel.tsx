import { useAgentStateStore } from '../../shared/stores/agent-state-store';

/**
 * 状态面板：只订阅 AgentStateStore（react-architecture.md §12.1），
 * 不接收 props，也不接触消息流。
 */
export function StatusPanel() {
  const latestEvent = useAgentStateStore((s) => s.latestEvent);
  const receivedCount = useAgentStateStore((s) => s.receivedCount);
  const state = useAgentStateStore((s) => s.state);
  const discreteTag = useAgentStateStore((s) => s.discreteTag);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-2 text-sm font-semibold">Agent 状态</h2>
      <div className="space-y-1 text-xs text-neutral-300">
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          <span>
            valence: <span className="text-sky-400">{state.valence.toFixed(2)}</span>
          </span>
          <span>
            arousal: <span className="text-amber-400">{state.arousal.toFixed(2)}</span>
          </span>
          <span>
            tag: <span className="text-emerald-400">{discreteTag}</span>
          </span>
        </p>
        {latestEvent ? (
          <>
            <p className="break-words text-neutral-400">原因：{latestEvent.reason}</p>
            <p className="text-neutral-500">
              事件计数（含 bootstrap 恢复）：{receivedCount}
            </p>
          </>
        ) : (
          <p className="text-neutral-500">尚未收到状态事件。</p>
        )}
      </div>
    </div>
  );
}