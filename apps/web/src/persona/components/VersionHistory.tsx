import { useState } from 'react';
import type { PersonaVersionDTO } from '@aiko/shared';

type Props = {
  versions: PersonaVersionDTO[];
  disabled: boolean;
  onRollback: (version: number) => void;
};

/** 版本历史：新→旧；非活跃版本可两步确认回滚（追加式，产生新版本号）。 */
export function VersionHistory({ versions, disabled, onRollback }: Props) {
  const [armedVersion, setArmedVersion] = useState<number | null>(null);

  return (
    <section aria-label="版本历史" className="rounded-lg border border-neutral-800 bg-neutral-800/50 p-3">
      <h3 className="mb-2 text-xs font-semibold text-neutral-400">版本历史</h3>
      <ul className="space-y-1.5">
        {versions.map((v) => {
          const armed = armedVersion === v.version;
          return (
            <li key={v.version} className="flex items-center justify-between text-xs">
              <span className={v.isActive ? 'text-emerald-400' : 'text-neutral-400'}>
                v{v.version}
                {v.isActive && '（生效中）'}
                <span className="ml-2 text-neutral-600">
                  {new Date(v.activatedAt ?? v.createdAt).toLocaleString()}
                </span>
              </span>
              {!v.isActive && (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={'回滚到 v' + v.version}
                  onClick={() => {
                    if (armed) {
                      setArmedVersion(null);
                      onRollback(v.version);
                    } else {
                      setArmedVersion(v.version);
                    }
                  }}
                  className={
                    armed
                      ? 'rounded border border-sky-400 bg-sky-950 px-1.5 py-0.5 text-sky-200 hover:bg-sky-900'
                      : 'rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800'
                  }
                >
                  {armed ? '确认回滚？' : '回滚'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
