import type { AppUIMessage } from '../types';
import { MessageItem } from './MessageItem';

export function MessageList({ messages }: { messages: AppUIMessage[] }) {
  return (
    <div
      aria-label="消息列表"
      className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 p-4"
    >
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </div>
  );
}