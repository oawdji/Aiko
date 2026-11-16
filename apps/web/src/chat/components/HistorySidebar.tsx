import type { ConversationListItem } from '@aiko/shared';

type Props = {
  items: ConversationListItem[];
  activeId: string;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
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
 */
export function HistorySidebar({
  items,
  activeId,
  loading,
  error,
  disabled,
  onSelect,
  onRetry,
  onClose,
}: Props) {
  return (
    <nav aria-label="历史记录" className="flex h-full min-h-0 w-full flex-col">
      <div className="flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-400">历史记录</h2>
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
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={disabled && !selected}
              onClick={() => onSelect(item.id)}
              className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-300 hover:bg-neutral-900'
              }`}
            >
              <span className="line-clamp-2 text-sm">{historyLabel(item)}</span>
              <span className="text-[11px] text-neutral-500">{historyTime(item)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
