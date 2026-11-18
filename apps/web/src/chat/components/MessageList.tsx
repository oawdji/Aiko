import type { AppUIMessage } from '../types';
import { MessageItem } from './MessageItem';

type Props = {
  messages: AppUIMessage[];
  /** 提供时在最后一条 assistant 消息下方展示"重新生成"按钮。 */
  onRegenerate?: () => void;
  /** 忙碌（提交/流式中）时禁用消息级操作。 */
  disabled?: boolean;
};

export function MessageList({ messages, onRegenerate, disabled }: Props) {
  const lastAssistantIndex = (() => {
    if (!onRegenerate) return -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'assistant') return i;
    }
    return -1;
  })();

  return (
    <div
      aria-label="消息列表"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-4"
    >
      {messages.length === 0 ? (
        <p className="m-auto max-w-xs text-center text-sm text-neutral-500">
          还没有消息。在下方输入，开始对话。
        </p>
      ) : (
        messages.map((message, index) => (
          <div key={message.id} className="flex flex-col gap-1">
            <MessageItem message={message} />
            {index === lastAssistantIndex && index === messages.length - 1 && (
              <div className="mr-auto">
                <button
                  type="button"
                  aria-label="重新生成这条回复"
                  disabled={disabled}
                  onClick={onRegenerate}
                  className="rounded-md px-2 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ↻ 重新生成
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}