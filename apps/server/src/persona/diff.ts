import { PERSONA_ANCHORS, type PersonaEvolvable } from '@aiko/shared';

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * 结构化 diff 摘要（F24）：只列发生变化的字段，before → after。
 * 纯函数；结果同时落库 diff_summary 与用于前端展示的依据。
 */
export function buildDiffSummary(current: PersonaEvolvable, next: PersonaEvolvable): string {
  const lines: string[] = [];
  if (next.verbosity !== current.verbosity) {
    lines.push(
      `- ${PERSONA_ANCHORS.verbosity.label}：${PERSONA_ANCHORS.verbosity.values[current.verbosity]} → ${PERSONA_ANCHORS.verbosity.values[next.verbosity]}`,
    );
  }
  const numeric: Array<[keyof typeof PERSONA_ANCHORS, number, number]> = [
    ['warmth', current.warmth, next.warmth],
    ['humor', current.humor, next.humor],
    ['proactiveQuestions', current.proactiveQuestions, next.proactiveQuestions],
  ];
  for (const [key, before, after] of numeric) {
    if (before !== after) {
      lines.push(`- ${PERSONA_ANCHORS[key].label}：${pct(before)} → ${pct(after)}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : '无变化';
}
