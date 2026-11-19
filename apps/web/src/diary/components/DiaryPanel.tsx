import { useCallback, useEffect, useState } from 'react';
import type { DiaryEntryDTO } from '@aiko/shared';
import { deleteDiary, fetchDiary } from '../../shared/api/diary-api';

const PAGE_SIZE = 30;

const TYPE_LABELS: Record<string, string> = {
  daily: '每日回顾',
  thought: '想法',
};

function moodEmoji(v: number | null): string {
  if (v === null) return '📝';
  if (v >= 0.3) return '😊';
  if (v <= -0.3) return '😔';
  return '😌';
}

function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${date} ${weekdays[d.getDay()]}`;
}

/**
 * 日记面板（虚拟人内心生活）：
 * - 按日期倒序浏览她的日记（惰性生成的每日回顾，未来含碎片想法）；
 * - 展开全文、删除（两步确认）；透明哲学——她的内心记录对你开放。
 */
export function DiaryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<DiaryEntryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDiary({ limit: PAGE_SIZE, offset });
      setItems((prev) => (offset === 0 ? data.items : [...prev, ...data.items]));
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load(0);
  }, [open, load]);

  const hasMore = items.length < total;

  const handleDelete = (entry: DiaryEntryDTO) => {
    if (deleteArmedId !== entry.id) {
      setDeleteArmedId(entry.id);
      return;
    }
    setDeleteArmedId(null);
    const prev = items;
    setItems((list) => list.filter((x) => x.id !== entry.id));
    setTotal((t) => Math.max(0, t - 1));
    deleteDiary(entry.id).catch(() => {
      setItems(prev);
      setError('删除失败');
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      role="dialog"
      aria-label="日记"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="flex h-full w-full max-w-lg flex-col border-l border-neutral-800 bg-neutral-900 p-4">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">📖 日记</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭日记"
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            ✕
          </button>
        </header>

        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="text-neutral-500">
            共 {items.length} / {total} 篇
          </span>
          <button
            type="button"
            onClick={() => void load(0)}
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

        {loading && items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
            加载中…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <span className="text-2xl">📖</span>
            <p className="text-sm text-neutral-400">还没有日记</p>
            <p className="max-w-72 text-xs text-neutral-600">
              聊过天的日子，她会在第二天自动补写一篇日记——记录聊了什么、感受到了什么，以及她自己的想法。
            </p>
          </div>
        ) : (
          <>
            <ul className="flex-1 space-y-2 overflow-y-auto pr-1">
              {items.map((entry) => (
                <li key={entry.id} className="rounded border border-neutral-800 bg-neutral-800/60 p-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    className="w-full text-left"
                    aria-expanded={expandedId === entry.id}
                  >
                    <div className="flex items-center gap-2">
                      <span aria-hidden="true">{moodEmoji(entry.mood?.valence ?? null)}</span>
                      <span className="text-xs font-medium text-neutral-200">{dateLabel(entry.date)}</span>
                      <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300">
                        {TYPE_LABELS[entry.type] ?? entry.type}
                      </span>
                    </div>
                    <p
                      className={
                        expandedId === entry.id
                          ? 'mt-2 whitespace-pre-wrap text-sm text-neutral-100'
                          : 'mt-1 line-clamp-3 text-sm text-neutral-300'
                      }
                    >
                      {entry.content}
                    </p>
                  </button>
                  {expandedId === entry.id && entry.mood && (
                    <p className="mt-2 text-[10px] text-neutral-500">
                      落笔时的心境：愉悦度 {entry.mood.valence.toFixed(2)} / 唤醒度{' '}
                      {entry.mood.arousal.toFixed(2)} / 支配度 {entry.mood.dominance.toFixed(2)}
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                      className="rounded border border-neutral-600 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
                    >
                      {expandedId === entry.id ? '收起' : '查看全文'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(entry)}
                      aria-label={deleteArmedId === entry.id ? '确认删除该日记' : '删除该日记'}
                      className={
                        deleteArmedId === entry.id
                          ? 'rounded border border-red-600 bg-red-950 px-2 py-0.5 text-xs text-red-300 hover:bg-red-900'
                          : 'rounded border border-red-900 px-2 py-0.5 text-xs text-red-400 hover:bg-red-950'
                      }
                    >
                      {deleteArmedId === entry.id ? '确认删除？' : '删除'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {hasMore && (
              <button
                type="button"
                onClick={() => void load(items.length)}
                disabled={loading}
                className="mt-3 w-full rounded border border-neutral-700 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              >
                {loading ? '加载中…' : '加载更多（共 ' + total + ' 篇）'}
              </button>
            )}
          </>
        )}

        <p className="mt-3 text-[10px] text-neutral-600">
          日记由她自动撰写，基于当天的对话与情绪；对你是开放的——这也是她性格的一部分。
        </p>
      </aside>
    </div>
  );
}