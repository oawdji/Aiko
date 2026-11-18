import { PERSONA_ANCHORS, type PersonaEvolvable } from '@aiko/shared';

/** 数值条 + 锚点词展示（与服务端 renderPersonaStyleSection 同一套词表）。 */
function NumericBar({ label, value, lowAnchor, highAnchor }: {
  label: string;
  value: number;
  lowAnchor: string;
  highAnchor: string;
}) {
  const pct = Math.round(value * 100);
  const tendency =
    value < 0.33 ? `偏向“${lowAnchor}”` : value > 0.67 ? `偏向“${highAnchor}”` : '居中';
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-neutral-300">
        <span>{label}</span>
        <span className="text-neutral-500">
          {pct}%（{tendency}）
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded bg-neutral-700">
        <div className="h-1.5 rounded bg-sky-500" style={{ width: pct + '%' }} />
      </div>
    </div>
  );
}

/** 当前生效的风格配置卡片。 */
export function StyleCard({ evolvable, version }: { evolvable: PersonaEvolvable; version: number }) {
  const a = PERSONA_ANCHORS;
  return (
    <section aria-label="当前风格" className="rounded-lg border border-neutral-800 bg-neutral-800/50 p-3">
      <h3 className="mb-2 text-xs font-semibold text-neutral-400">当前风格（v{version}）</h3>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs text-neutral-300">
          <span>{a.verbosity.label}</span>
          <span className="text-neutral-500">
            {a.verbosity.values[evolvable.verbosity]}（介于“{a.verbosity.lowAnchor}”与“{a.verbosity.highAnchor}”之间）
          </span>
        </div>
        <NumericBar label={a.warmth.label} value={evolvable.warmth} lowAnchor={a.warmth.lowAnchor} highAnchor={a.warmth.highAnchor} />
        <NumericBar label={a.humor.label} value={evolvable.humor} lowAnchor={a.humor.lowAnchor} highAnchor={a.humor.highAnchor} />
        <NumericBar
          label={a.proactiveQuestions.label}
          value={evolvable.proactiveQuestions}
          lowAnchor={a.proactiveQuestions.lowAnchor}
          highAnchor={a.proactiveQuestions.highAnchor}
        />
        {evolvable.notes.length > 0 && (
          <p className="text-xs text-neutral-500">备注：{evolvable.notes.join('；')}</p>
        )}
      </div>
    </section>
  );
}
