import type { AppUIMessage } from '../types';
import { MessageItem } from './MessageItem';

export function MessageList({ messages }: { messages: AppUIMessage[] }) {
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
        messages.map((message) => <MessageItem key={message.id} message={message} />)
      )}
    </div>
  );
}