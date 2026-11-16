import { useState } from 'react';

type Props = {
  onSend: (text: string) => void;
  onStop?: () => void;
  isBusy: boolean;
};

/**
 * 草稿由本组件独立管理（react-architecture.md §13.2），
 * 提交时通过 onSend(text) 上抛。
 */
export function MessageComposer({ onSend, onStop, isBusy }: Props) {
  const [draft, setDraft] = useState('');

  const send = () => {
    const text = draft.trim();
    if (!text || isBusy) return;
    setDraft('');
    onSend(text);
  };

  return (
    <footer className="flex items-end gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            send();
          }
        }}
        placeholder="试试：我刚才说了什么？（含“409”可测冲突）"
        className="min-w-0 flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-base outline-none focus:border-sky-600 sm:text-sm"
      />
      <button
        type="button"
        onClick={send}
        disabled={!draft.trim() || isBusy}
        className="shrink-0 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-sky-600"
      >
        {isBusy ? '生成中…' : '发送'}
      </button>
      {isBusy && onStop && (
        <button
          type="button"
          onClick={onStop}
          className="shrink-0 rounded-xl bg-neutral-700 px-4 py-2.5 text-sm font-medium hover:bg-neutral-600"
        >
          停止
        </button>
      )}
    </footer>
  );
}