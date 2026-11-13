import { useCallback, useEffect, useState } from 'react';
import type { MemoryFactDTO, MemoryStatus, MemoryType } from '@aiko/shared';
import {
  confirmMemory,
  deleteMemory,
  fetchMemories,
  patchMemory,
  rejectMemory,
} from '../../shared/api/memories-api';

/**
 * 记忆查看器（F17，memory-emotion-design.md §7.2）：
 * - 列表 + status/type 筛选 + 置信度/strength 展示；
 * - 确认 / 拒绝 / 编辑 / 删除，乐观更新 + 服务端最终态回写（F17 硬性要求）；
 * - 组件只通过 memories-api 访问接口，不直接 fetch。
 */

const STATUS_LABELS: Record<MemoryStatus, string> = {
  candidate: '待确认',
  active: '生效中',
  outdated: '已过时',
  rejected: '已拒绝',
  deleted: '已删除',
};

const TYPE_LABELS: Record<MemoryType, string> = {
  fact: '事实',
  preference: '偏好',
  goal: '目标',
  episode: '事件',
  relationship: '关系',
};

type FilterStatus = MemoryStatus | 'all';
type FilterType = MemoryType | 'all';

export function MemoryViewer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [memories, setMemories] = useState<MemoryFactDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMemories({ limit: 100 });
      setMemories(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /** 乐观更新：先改本地，再以服务端最终态回写；失败时回滚并提示。 */
  const applyOptimistic = useCallback(
    async (id: string, optimistic: (m: MemoryFactDTO) => MemoryFactDTO, action: () => Promise<MemoryFactDTO>) => {
      const prev = memories;
      setMemories((list) => list.map((m) => (m.id === id ? optimistic(m) : m)));
      try {
        const final = await action();
        setMemories((list) => list.map((m) => (m.id === id ? final : m)));
      } catch (e) {
        setMemories(prev);
        setError(e instanceof Error ? e.message : '操作失败');
      }
    },
    [memories],
  );

  if (!open) return null;

  const visible = memories.filter(
    (m) =>
      (statusFilter === 'all' || m.status === statusFilter) &&
      (typeFilter === 'all' || m.type === typeFilter),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      role="dialog"
      aria-label="记忆查看器"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="flex h-full w-full max-w-lg flex-col border-l border-neutral-800 bg-neutral-900 p-4">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">记忆查看器</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭记忆查看器"
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            ✕
          </button>
        </header>

        <div className="mb-3 flex gap-2 text-xs">
          <select
            aria-label="按状态筛选"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
          >
            <option value="all">全部状态</option>
            {(Object.keys(STATUS_LABELS) as MemoryStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="按类型筛选"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as FilterType)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
          >
            <option value="all">全部类型</option>
            {(Object.keys(TYPE_LABELS) as MemoryType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            刷新
          </button>
        </div>

        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
        {loading && <p className="text-xs text-neutral-500">加载中…</p>}
        {!loading && visible.length === 0 && (
          <p className="text-xs text-neutral-500">暂无记忆。</p>
        )}

        <ul className="flex-1 space-y-2 overflow-y-auto pr-1">
          {visible.map((m) => (
            <li key={m.id} className="rounded-lg border border-neutral-800 bg-neutral-800/40 p-3 text-xs">
              {editingId === m.id ? (
                <div className="flex gap-2">
                  <input
                    aria-label="编辑记忆内容"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void applyOptimistic(
                        m.id,
                        (mem) => ({ ...mem, content: editText }),
                        () => patchMemory(m.id, { content: editText }),
                      );
                      setEditingId(null);
                    }}
                    className="rounded bg-sky-500 px-2 py-1 text-neutral-950 hover:bg-sky-400"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded border border-neutral-700 px-2 py-1"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-neutral-100">{m.content}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-neutral-500">
                    <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-neutral-200">
                      {TYPE_LABELS[m.type]}
                    </span>
                    <span
                      className={
                        m.status === 'active'
                          ? 'text-emerald-400'
                          : m.status === 'candidate'
                            ? 'text-amber-400'
                            : 'text-neutral-400'
                      }
                    >
                      {STATUS_LABELS[m.status]}
                    </span>
                    <span>置信度 {(m.confidence * 100).toFixed(0)}%</span>
                    <span>强度 {(m.strength * 100).toFixed(0)}%</span>
                    {m.lastAccessedAt && (
                      <span>最近访问 {new Date(m.lastAccessedAt).toLocaleString()}</span>
                    )}
                  </div>
                  <div className="mt-2 flex gap-2">
                    {m.status === 'candidate' && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void applyOptimistic(
                              m.id,
                              (mem) => ({ ...mem, status: 'active' }),
                              () => confirmMemory(m.id),
                            )
                          }
                          className="rounded border border-emerald-600 px-2 py-0.5 text-emerald-400 hover:bg-emerald-950"
                        >
                          确认
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void applyOptimistic(
                              m.id,
                              (mem) => ({ ...mem, status: 'rejected' }),
                              () => rejectMemory(m.id),
                            )
                          }
                          className="rounded border border-neutral-600 px-2 py-0.5 text-neutral-400 hover:bg-neutral-800"
                        >
                          拒绝
                        </button>
                      </>
                    )}
                    {m.status !== 'deleted' && m.status !== 'rejected' && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(m.id);
                          setEditText(m.content);
                        }}
                        className="rounded border border-neutral-600 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800"
                      >
                        编辑
                      </button>
                    )}
                    {m.status !== 'deleted' && (
                      <button
                        type="button"
                        onClick={() =>
                          void applyOptimistic(
                            m.id,
                            (mem) => ({ ...mem, status: 'deleted' }),
                            () => deleteMemory(m.id),
                          )
                        }
                        className="rounded border border-red-900 px-2 py-0.5 text-red-400 hover:bg-red-950"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[10px] text-neutral-600">
          注意：记忆内容会发送给所配置的 LLM 服务用于对话。
        </p>
      </aside>
    </div>
  );
}
