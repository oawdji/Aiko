import { useCallback, useEffect, useState } from 'react';
import type { PromptSnapshotDTO } from '@aiko/shared';
import {
  clearPromptSnapshots,
  fetchPromptSnapshots,
} from '../../shared/api/prompt-snapshots-api';

/**
 * Prompt 快照查看器（F36）：debug 模式下每次聊天的 system prompt 快照。
 * 用途：审计上下文组装（人格/情绪/记忆/摘要/插件注入）是否生效。
 */
export function PromptSnapshotViewer() {
  const [items, setItems] = useState<PromptSnapshotDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPromptSnapshots({ limit: 20 });
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleClear = async () => {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearArmed(false);
    try {
      await clearPromptSnapshots();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '清空失败');
    }
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Prompt 快照（{total}）</h2>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => void load()}
            aria-label="刷新 Prompt 快照"
            className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800"
          >
            刷新
          </button>
          {total > 0 && (
            <button
              type="button"
              onClick={() => void handleClear()}
              aria-label={clearArmed ? '确认清空全部快照' : '清空全部快照'}
              className={
                clearArmed
                  ? 'rounded border border-red-600 bg-red-950 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-900'
                  : 'rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800'
              }
            >
              {clearArmed ? '确认清空？' : '清空'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-2 rounded border border-red-900 bg-red-950 px-2 py-1 text-xs text-red-300">
          {error}
        </p>
      )}

      {loading && items.length === 0 ? (
        <p className="text-xs text-neutral-500">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-neutral-500">
          暂无快照。在设置中开启调试模式后，每次聊天会记录当轮 system prompt 全文。
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((snap) => (
            <li key={snap.id} className="rounded bg-neutral-950/60">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === snap.id ? null : snap.id)}
                aria-expanded={expandedId === snap.id}
                className="w-full px-2 py-1.5 text-left"
              >
                <p className="text-[10px] text-neutral-500">
                  {new Date(snap.createdAt).toLocaleString()} · 窗口 {snap.recentWindowCount} 条
                  {snap.personaVersion !== null && ` · 人格 v${snap.personaVersion}`}
                  {' · 记忆 '} {snap.memoryIds.length} 条
                </p>
                <p className="truncate text-[10px] text-neutral-400">
                  {snap.systemText.slice(0, 80)}…
                </p>
              </button>
              {expandedId === snap.id && (
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-t border-neutral-800 px-2 py-1.5 text-[10px] text-neutral-300">
                  {snap.systemText}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}