import { useState } from 'react';

type Props = {
  disabled: boolean;
  onSubmit: (requestText: string) => Promise<void>;
};

/** 提案请求表单：描述想要的调整 → 生成结构化提案（不直接生效）。 */
export function ProposeForm({ disabled, onSubmit }: Props) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(text.trim());
      setText('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-800/50 p-3">
      <label htmlFor="persona-request" className="mb-1 block text-xs font-semibold text-neutral-400">
        调整表达风格
      </label>
      <textarea
        id="persona-request"
        rows={2}
        value={text}
        disabled={disabled || submitting}
        onChange={(e) => setText(e.target.value)}
        placeholder="例如：以后回答更简洁一点 / 语气再热情一些"
        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
      />
      <button
        type="button"
        disabled={disabled || submitting || !text.trim()}
        onClick={() => void submit()}
        className="mt-2 w-full rounded bg-sky-500 py-1.5 text-sm text-neutral-950 hover:bg-sky-400 disabled:opacity-50"
      >
        {submitting ? '生成中…' : '生成提案'}
      </button>
      <p className="mt-1 text-[10px] text-neutral-600">
        生成后需确认才会生效；单次数值变化最多 0.2。
      </p>
    </div>
  );
}
