import { useState } from 'react';
import type { ConversationListItem } from '@aiko/shared';

type Props = {
  items: ConversationListItem[];
  activeId: string;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onRetry: () => void;
  onClose?: () => void;
};

function historyLabel(item: ConversationListItem): string {
  const title = item.title?.trim();
  if (title) return title;
  if (item.preview) return item.preview;
  return '新会话';
}

function historyTime(item: ConversationListItem): string {
  const iso = item.lastMessageAt ?? item.updatedAt;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/**
 * 左侧历史记录。宽屏常驻，窄屏由外层收成抽屉。
 * 支持单会话删除与一键清空（均为两步确认，不可恢复）。
 */
export function HistorySidebar({
  items,
  activeId,
  loading,
  error,
  disabled,
  onSelect,
  onNew,
  onDelete,
  onClearAll,
  onRetry,
  onClose,
}: Props) {
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);

  const handleDelete = (id: string) => {
    if (deleteArmedId !== id) {
      setDeleteArmedId(id);
      return;
    }
    setDeleteArmedId(null);
    onDelete(id);
  };

  return (
    <nav aria-label="历史记录" className="flex h-full min-h-0 w-full flex-col">
      <div className="flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-400">历史记录</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="新建会话"
            disabled={disabled}
            onClick={onNew}
            className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ＋ 新会话
          </button>
          {items.length > 0 && (
            <button
              type="button"
              aria-label="清空全部会话"
              disabled={disabled}
              onClick={() => {
                if (!clearArmed) {
                  setClearArmed(true);
                  return;
                }
                setClearArmed(false);
                onClearAll();
              }}
              className={
                clearArmed
                  ? 'rounded-md border border-red-600 bg-red-950 px-2 py-1 text-[11px] text-red-300 hover:bg-red-900'
                  : 'rounded-md px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
              }
            >
              {clearArmed ? '确认清空？' : '清空'}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              aria-label="关闭历史记录"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 lg:hidden"
            >
              关闭
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-2 mb-2 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          <p>{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 text-red-200 underline-offset-2 hover:underline"
          >
            重试
          </button>
        </div>
      )}

      <div role="tablist" aria-label="历史会话" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {loading && items.length === 0 && (
          <p className="px-2 py-3 text-xs text-neutral-500">正在加载历史…</p>
        )}
        {!loading && items.length === 0 && !error && (
          <p className="px-2 py-3 text-xs text-neutral-500">还没有历史会话。</p>
        )}
        {items.map((item) => {
          const selected = item.id === activeId;
          const armed = deleteArmedId === item.id;
          return (
            <div key={item.id} className="relative">
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                disabled={disabled && !selected}
                onClick={() => onSelect(item.id)}
                className={`flex w-full flex-col gap-0.5 rounded-lg py-2 pl-3 pr-10 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected
                    ? 'bg-neutral-800 text-neutral-100'
                    : 'text-neutral-300 hover:bg-neutral-900'
                }`}
              >
                <span className="line-clamp-2 text-sm">{historyLabel(item)}</span>
                <span className="text-[11px] text-neutral-500">{historyTime(item)}</span>
              </button>
              <button
                type="button"
                aria-label={armed ? '确认删除该会话' : '删除该会话'}
                disabled={disabled}
                onClick={() => handleDelete(item.id)}
                className={`absolute right-1.5 top-2 rounded px-1.5 py-0.5 text-[10px] disabled:opacity-50 ${
                  armed
                    ? 'border border-red-600 bg-red-950 text-red-300 hover:bg-red-900'
                    : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'
                }`}
              >
                {armed ? '确认' : '✕'}
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
