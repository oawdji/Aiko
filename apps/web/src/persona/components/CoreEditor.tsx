import { useEffect, useState } from 'react';
import type { PersonaCoreResponse } from '@aiko/shared';
import { updatePersonaCore } from '../api/persona-api';

type Props = {
  core: PersonaCoreResponse | null;
  disabled: boolean;
  onSaved: (version: number) => void;
  onError: (message: string) => void;
};

/**
 * 人格锚点编辑器（本地所有者权限）：
 * 修改以新版本生效并写入审计；聊天/LLM/检索内容仍无权修改锚点。
 */
export function CoreEditor({ core, disabled, onSaved, onError }: Props) {
  const [text, setText] = useState('');
  const [armed, setArmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (core) setText(core.coreMd);
  }, [core]);

  if (!core) return null;

  const save = async () => {
    if (!armed || submitting || !text.trim()) return;
    setSubmitting(true);
    try {
      const r = await updatePersonaCore(text);
      setArmed(false);
      onSaved(r.version);
    } catch (e) {
      onError(e instanceof Error ? e.message : '锚点保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <details className="rounded-lg border border-neutral-800 bg-neutral-800/50 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-neutral-400">
        人格锚点正文（当前 v{core.version}，点击展开编辑）
      </summary>
      <textarea
        aria-label="编辑人格锚点正文"
        rows={10}
        value={text}
        disabled={disabled || submitting}
        onChange={(e) => setText(e.target.value)}
        className="mt-2 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 font-mono text-xs text-neutral-100"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || submitting || !text.trim() || text === core.coreMd}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            void save();
          }}
          className={
            armed
              ? 'rounded border border-emerald-400 bg-emerald-950 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-900'
              : 'rounded bg-sky-500 px-2 py-1 text-xs text-neutral-950 hover:bg-sky-400 disabled:opacity-50'
          }
        >
          {submitting ? '保存中…' : armed ? '确认保存为新版本？' : '保存为新版本'}
        </button>
        <span className="text-[10px] text-neutral-600">
          修改会版本化生效；聊天与注入内容无权修改锚点。
        </span>
      </div>
    </details>
  );
}
