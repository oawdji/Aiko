import type { AgentStateEvent } from '@aiko/shared';

type Props = {
  latestEvent: AgentStateEvent | null;
  receivedCount: number;
};

/**
 * Phase 0 呈现型面板：数据由父级传入。
 * M2 起 AgentStateStore 落地后，将改为自行订阅 store（react-architecture.md §12.1）。
 */
export function StatusPanel({ latestEvent, receivedCount }: Props) {
  return (
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
            / tag:{' '}
            <span className="text-emerald-400">{latestEvent.discreteTag}</span>
          </p>
          <p className="text-neutral-400">原因：{latestEvent.reason}</p>
          <p className="text-neutral-500">
            事件流顺序验证：状态事件应先于文本增量到达（共收到 {receivedCount}{' '}
            个事件）
          </p>
        </div>
      ) : (
        <p className="text-xs text-neutral-500">尚未收到状态事件。</p>
      )}
    </div>
  );
}