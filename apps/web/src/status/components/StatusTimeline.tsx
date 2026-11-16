import { useCallback, useEffect, useState } from 'react';
import type { AgentStateEvent } from '@aiko/shared';
import { fetchStateEvents } from '../../shared/api/state-api';

/**
 * 状态时间线（F11，memory-emotion-design.md §7.2）：
 * beforeId 游标分页展示状态事件因果链（before→after + 原因）。
 * 只通过 state-api 访问接口。
 */
export function StatusTimeline({ agentId }: { agentId: string }) {
  const [events, setEvents] = useState<AgentStateEvent[]>([]);
  const [nextBeforeId, setNextBeforeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchStateEvents(agentId, { limit: 20 });
      setEvents(page.items);
      setNextBeforeId(page.nextPage?.beforeId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (expanded) void loadFirst();
  }, [expanded, loadFirst]);

  const loadMore = useCallback(async () => {
    if (!nextBeforeId) return;
    setLoading(true);
    try {
      const page = await fetchStateEvents(agentId, {
        limit: 20,
        beforeId: nextBeforeId,
      });
      setEvents((list) => [...list, ...page.items]);
      setNextBeforeId(page.nextPage?.beforeId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [agentId, nextBeforeId]);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between text-left"
      >
        <h2 className="text-sm font-semibold">状态时间线</h2>
        <span className="text-xs text-neutral-500">{expanded ? '收起' : '展开'}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {error && <p className="text-xs text-red-400">{error}</p>}
          {loading && <p className="text-xs text-neutral-500">加载中…</p>}
          {!loading && events.length === 0 && !error && (
            <p className="text-xs text-neutral-500">还没有状态事件。</p>
          )}
          <ol className="space-y-2">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="rounded-lg border border-neutral-800 bg-neutral-800/40 p-2.5 text-xs"
              >
                <div className="flex items-center justify-between text-neutral-400">
                  <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-emerald-400">
                    {ev.discreteTag}
                  </span>
                  <span>{new Date(ev.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1.5 text-neutral-200">{ev.reason}</p>
                <p className="mt-1 text-neutral-500">
                  证据：{ev.evidenceText || '（无）'} · 置信度{' '}
                  {(ev.confidence * 100).toFixed(0)}%
                </p>
                <p className="mt-1 text-[10px] text-neutral-600">
                  V {ev.before.valence.toFixed(2)}→{ev.after.valence.toFixed(2)} · A{' '}
                  {ev.before.arousal.toFixed(2)}→{ev.after.arousal.toFixed(2)} · D{' '}
                  {ev.before.dominance.toFixed(2)}→{ev.after.dominance.toFixed(2)}
                </p>
              </li>
            ))}
          </ol>
          {nextBeforeId && (
            <button
              type="button"
              onClick={() => void loadMore()}
              className="w-full rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              加载更早事件
            </button>
          )}
        </div>
      )}
    </div>
  );
}
