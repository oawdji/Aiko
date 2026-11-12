import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { AgentEmotionState } from '@aiko/shared';

type EmotionDimension = {
  key: keyof AgentEmotionState;
  label: string;
  barClassName: string;
  valueClassName: string;
};

const dimensions: readonly EmotionDimension[] = [
  { key: 'valence', label: 'V 愉悦度', barClassName: 'bg-sky-400', valueClassName: 'text-sky-400' },
  { key: 'arousal', label: 'A 唤醒度', barClassName: 'bg-amber-400', valueClassName: 'text-amber-400' },
  { key: 'dominance', label: 'D 支配度', barClassName: 'bg-violet-400', valueClassName: 'text-violet-400' },
];

function barStyle(value: number): CSSProperties {
  const magnitude = Math.abs(value);
  return {
    left: value >= 0 ? '50%' : `${50 - magnitude * 50}%`,
    width: `${magnitude * 50}%`,
  };
}

/**
 * 只做后端 PAD 状态的展示映射，不在前端计算或修正情绪值。
 */
export const EmotionBars = memo(function EmotionBars({ state }: { state: AgentEmotionState }) {
  return (
    <section aria-label="PAD 情绪状态" className="space-y-2">
      {dimensions.map(({ key, label, barClassName, valueClassName }) => {
        const value = state[key];
        return (
          <div key={key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-neutral-300">{label}</span>
              <span className={`font-medium tabular-nums ${valueClassName}`}>
                {value >= 0 ? '+' : '−'}
                {Math.abs(value).toFixed(2)}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-neutral-800">
              <span
                aria-hidden
                className={`absolute inset-y-0 rounded-full ${barClassName}`}
                style={barStyle(value)}
              />
              <span
                aria-hidden
                className="absolute inset-y-[-3px] left-1/2 w-px bg-neutral-600"
              />
            </div>
            <span className="sr-only">
              {label}：{value.toFixed(2)}，{value >= 0 ? '正向' : '负向'}
            </span>
          </div>
        );
      })}
    </section>
  );
});
