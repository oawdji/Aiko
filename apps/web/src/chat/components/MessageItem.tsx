import type { AppUIMessage } from '../types';

const roleLabel: Record<string, string> = {
  user: '你',
  assistant: 'Aiko',
  system: '系统',
};

export function MessageItem({ message }: { message: AppUIMessage }) {
  return (
    <div
      className={
        message.role === 'user'
          ? 'ml-auto max-w-[80%] rounded-xl bg-sky-900/60 px-3 py-2'
          : 'mr-auto max-w-[80%] rounded-xl bg-neutral-800 px-3 py-2'
      }
    >
      <div className="mb-0.5 text-xs text-neutral-400">
        {roleLabel[message.role] ?? message.role}
      </div>
      <div className="text-sm whitespace-pre-wrap">
        {message.parts.map((part, index) =>
          part.type === 'text' ? <span key={index}>{part.text}</span> : null,
        )}
      </div>
    </div>
  );
}