import { useCallback, useEffect, useState } from 'react';
import type { ConversationSummaryDTO, MemoryFactDTO, MemoryStatus, MemoryType } from '@aiko/shared';
import {
  clearMemories,
  confirmMemory,
  deleteMemory,
  fetchMemories,
  patchMemory,
  rejectMemory,
  restoreMemory,
} from '../../shared/api/memories-api';
import { deleteSummary, fetchSummaries } from '../../shared/api/summaries-api';

/**
 * 记忆查看器（F17，memory-emotion-design.md §7.2）：
 * - 列表 + 状态/类型/关键词筛选（服务端过滤）+ 分页加载 + 来源消息展示；
 * - 确认 / 拒绝 / 编辑（内容+类型）/ 删除（两步确认）/ 恢复过时记忆；
 * - 清空全部（两步确认）、空状态；乐观更新 + 服务端最终态回写（F17 硬性要求）；
 * - 组件只通过 memories-api 访问接口，不直接 fetch。
 */

const PAGE_SIZE = 50;

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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchText, setSearchText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editType, setEditType] = useState<MemoryType>('fact');
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<'memories' | 'summaries'>('memories');

  // 搜索防抖：输入停顿 300ms 后才触发服务端查询
  useEffect(() => {
    const timer = setTimeout(() => setSearchText(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchMemories({
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
          ...(searchText.trim() ? { q: searchText.trim() } : {}),
          limit: PAGE_SIZE,
          offset,
        });
        setMemories((prev) => (offset === 0 ? data.memories : [...prev, ...data.memories]));
        setTotal(data.total ?? offset + data.memories.length);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, typeFilter, searchText],
  );

  // 首次打开 / 筛选条件变化 → 回到第一页重新加载
  useEffect(() => {
    if (open) void load(0);
  }, [open, load]);

  const hasMore = memories.length < total;

  /** 乐观更新：先改本地，再以服务端最终态回写；失败时回滚并提示。 */
  const applyOptimistic = useCallback(
    async (
      id: string,
      optimistic: (m: MemoryFactDTO) => MemoryFactDTO,
      action: () => Promise<MemoryFactDTO>,
    ) => {
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

  /** 两步确认清空：第一次点击进入待确认态，再次点击才执行。 */
  const handleClearAll = useCallback(async () => {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearing(true);
    setError(null);
    try {
      await clearMemories();
      setClearArmed(false);
      await load(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '清空失败');
      setClearArmed(false);
    } finally {
      setClearing(false);
    }
  }, [clearArmed, load]);

  /** 两步确认删除：同一按钮再次点击才执行。 */
  const handleDelete = useCallback(
    (m: MemoryFactDTO) => {
      if (deleteArmedId !== m.id) {
        setDeleteArmedId(m.id);
        return;
      }
      setDeleteArmedId(null);
      void applyOptimistic(
        m.id,
        (mem) => ({ ...mem, status: 'deleted' }),
        () => deleteMemory(m.id),
      );
    },
    [deleteArmedId, applyOptimistic],
  );

  if (!open) return null;

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

        <div className="mb-2 flex gap-1 text-xs" role="tablist" aria-label="查看器分区">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'memories'}
            onClick={() => setView('memories')}
            className={
              view === 'memories'
                ? 'rounded border border-neutral-600 bg-neutral-800 px-3 py-1 text-neutral-100'
                : 'rounded border border-neutral-800 px-3 py-1 text-neutral-400 hover:bg-neutral-800'
            }
          >
            记忆
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'summaries'}
            onClick={() => setView('summaries')}
            className={
              view === 'summaries'
                ? 'rounded border border-neutral-600 bg-neutral-800 px-3 py-1 text-neutral-100'
                : 'rounded border border-neutral-800 px-3 py-1 text-neutral-400 hover:bg-neutral-800'
            }
          >
            会话摘要
          </button>
        </div>

        {view === 'summaries' ? (
          <SummariesView />
        ) : (
        <>
        <div className="mb-2 flex gap-2 text-xs">
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
          <input
            type="search"
            aria-label="搜索记忆内容"
            placeholder="搜索内容…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100 placeholder:text-neutral-500"
          />
        </div>

        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="text-neutral-500">
            已显示 {memories.length} / {total} 条
          </span>
          {memories.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClearAll()}
              disabled={clearing}
              aria-label="清空全部记忆"
              className={
                clearArmed
                  ? 'rounded border border-red-600 bg-red-950 px-2 py-1 text-red-300 hover:bg-red-900'
                  : 'rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800'
              }
            >
              {clearing ? '清空中…' : clearArmed ? '确认清空？' : '清空全部'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void load(0)}
            className="ml-auto rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            刷新
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="mb-2 rounded border border-red-900 bg-red-950 px-2 py-1 text-xs text-red-300"
          >
            {error}
          </p>
        )}

        {loading && memories.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
            加载中…
          </div>
        ) : memories.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <span className="text-2xl">🧠</span>
            <p className="text-sm text-neutral-400">暂无记忆</p>
            <p className="max-w-64 text-xs text-neutral-600">
              和她聊聊重要的事，她会慢慢记住；待确认的抽取结果也会出现在这里。
            </p>
          </div>
        ) : (
          <>
            <ul className="flex-1 space-y-2 overflow-y-auto pr-1">
              {memories.map((m) => (
                <li
                  key={m.id}
                  className="rounded border border-neutral-800 bg-neutral-800/60 p-3"
                >
                  {editingId === m.id ? (
                    <div className="space-y-2">
                      <textarea
                        aria-label="编辑记忆内容"
                        rows={3}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
                      />
                      <div className="flex items-center gap-2">
                        <select
                          aria-label="编辑记忆类型"
                          value={editType}
                          onChange={(e) => setEditType(e.target.value as MemoryType)}
                          className="rounded border border-neutral-600 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        >
                          {(Object.keys(TYPE_LABELS) as MemoryType[]).map((t) => (
                            <option key={t} value={t}>
                              {TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!editText.trim()}
                          onClick={() => {
                            void applyOptimistic(
                              m.id,
                              (mem) => ({ ...mem, content: editText, type: editType }),
                              () => patchMemory(m.id, { content: editText, type: editType }),
                            );
                            setEditingId(null);
                          }}
                          className="rounded bg-sky-500 px-2 py-1 text-neutral-950 hover:bg-sky-400 disabled:opacity-50"
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
                    </div>
                  ) : (
                    <>
                      <p
                        onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                        title={expandedId === m.id ? '点击收起' : '点击展开'}
                        className={
                          expandedId === m.id
                            ? 'cursor-pointer text-neutral-100'
                            : 'line-clamp-2 cursor-pointer text-neutral-100'
                        }
                      >
                        {m.content}
                      </p>
                      {m.sourceContent && (
                        <p
                          className="mt-1 line-clamp-1 text-[11px] text-neutral-500"
                          title={'来源消息：' + m.sourceContent}
                        >
                          来源：{m.sourceContent}
                        </p>
                      )}
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
                        {m.status === 'outdated' && (
                          <button
                            type="button"
                            onClick={() =>
                              void applyOptimistic(
                                m.id,
                                (mem) => ({ ...mem, status: 'active' }),
                                () => restoreMemory(m.id),
                              )
                            }
                            className="rounded border border-sky-600 px-2 py-0.5 text-sky-400 hover:bg-sky-950"
                          >
                            重新激活
                          </button>
                        )}
                        {m.status !== 'deleted' && m.status !== 'rejected' && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(m.id);
                              setEditText(m.content);
                              setEditType(m.type);
                            }}
                            className="rounded border border-neutral-600 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800"
                          >
                            编辑
                          </button>
                        )}
                        {m.status !== 'deleted' && (
                          <button
                            type="button"
                            onClick={() => handleDelete(m)}
                            aria-label={deleteArmedId === m.id ? '确认删除该记忆' : '删除该记忆'}
                            className={
                              deleteArmedId === m.id
                                ? 'rounded border border-red-600 bg-red-950 px-2 py-0.5 text-red-300 hover:bg-red-900'
                                : 'rounded border border-red-900 px-2 py-0.5 text-red-400 hover:bg-red-950'
                            }
                          >
                            {deleteArmedId === m.id ? '确认删除？' : '删除'}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {hasMore && (
              <button
                type="button"
                onClick={() => void load(memories.length)}
                disabled={loading}
                className="mt-3 w-full rounded border border-neutral-700 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              >
                {loading ? '加载中…' : '加载更多（共 ' + total + ' 条）'}
              </button>
            )}
          </>
        )}
        </>
        )}

        <p className="mt-3 text-[10px] text-neutral-600">
          注意：记忆与摘要内容会发送给所配置的 LLM 服务用于对话。
        </p>
      </aside>
    </div>
  );
}

/**
 * 会话摘要分区（透明性：她记得的阶段性回顾对用户可见、可删除）。
 * 挂载时加载；删除为两步确认 + 乐观移除；查看 = 展开/收起全文。
 */
function SummariesView() {
  const [items, setItems] = useState<ConversationSummaryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await fetchSummaries()).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = (s: ConversationSummaryDTO) => {
    if (armedId !== s.id) {
      setArmedId(s.id);
      return;
    }
    setArmedId(null);
    const prev = items;
    setItems((list) => list.filter((x) => x.id !== s.id));
    deleteSummary(s.id).catch(() => {
      setItems(prev);
      setError('删除失败');
    });
  };

  if (loading && items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        加载中…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-neutral-500">共 {items.length} 条</span>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
        >
          刷新
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-2 rounded border border-red-900 bg-red-950 px-2 py-1 text-xs text-red-300">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <span className="text-2xl">📝</span>
          <p className="text-sm text-neutral-400">暂无会话摘要</p>
          <p className="max-w-64 text-xs text-neutral-600">
            每累计 30 条消息会自动生成一份阶段性回顾，帮助你了解她记得哪些对话脉络。
          </p>
        </div>
      ) : (
        <ul className="flex-1 space-y-2 overflow-y-auto pr-1">
          {items.map((s) => (
            <li key={s.id} className="rounded border border-neutral-800 bg-neutral-800/60 p-3">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                className="w-full text-left"
                aria-expanded={expandedId === s.id}
              >
                <p className="text-xs text-neutral-500">
                  {new Date(s.createdAt).toLocaleString()} · {s.conversationId}
                </p>
                <p
                  className={
                    expandedId === s.id
                      ? 'mt-1 whitespace-pre-wrap text-sm text-neutral-100'
                      : 'mt-1 line-clamp-2 text-sm text-neutral-300'
                  }
                >
                  {s.content}
                </p>
              </button>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  className="rounded border border-neutral-600 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  {expandedId === s.id ? '收起' : '查看全文'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(s)}
                  aria-label={armedId === s.id ? '确认删除该摘要' : '删除该摘要'}
                  className={
                    armedId === s.id
                      ? 'rounded border border-red-600 bg-red-950 px-2 py-0.5 text-xs text-red-300 hover:bg-red-900'
                      : 'rounded border border-red-900 px-2 py-0.5 text-xs text-red-400 hover:bg-red-950'
                  }
                >
                  {armedId === s.id ? '确认删除？' : '删除'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[10px] text-neutral-600">
        摘要会在对话时自动注入她的记忆；删除后不再注入，但已生成的记忆事实不受影响。
      </p>
    </div>
  );
}