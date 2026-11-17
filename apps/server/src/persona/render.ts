import { PERSONA_ANCHORS, type PersonaEvolvable } from '@aiko/shared';

function describeNumeric(value: number, lowAnchor: string, highAnchor: string): string {
  const pct = Math.round(value * 100);
  let tendency: string;
  if (value < 0.33) {
    tendency = `偏向“${lowAnchor}”`;
  } else if (value > 0.67) {
    tendency = `偏向“${highAnchor}”`;
  } else {
    tendency = `居中，介于“${lowAnchor}”与“${highAnchor}”之间`;
  }
  return `${pct}%（${tendency}）`;
}

/**
 * 把 evolvable 配置渲染为注入 system 的风格段（锚点词 + 数值，仿 OpenHer signal_buckets）。
 * 纯函数，无 IO。
 */
export function renderPersonaStyleSection(e: PersonaEvolvable, version: number): string {
  const a = PERSONA_ANCHORS;
  const lines = [
    `[表达风格配置 v${version}]`,
    `- 回答长度：${a.verbosity.values[e.verbosity]}（介于“${a.verbosity.lowAnchor}”与“${a.verbosity.highAnchor}”之间）`,
    `- 语气温度：${describeNumeric(e.warmth, a.warmth.lowAnchor, a.warmth.highAnchor)}`,
    `- 幽默程度：${describeNumeric(e.humor, a.humor.lowAnchor, a.humor.highAnchor)}`,
    `- 主动追问：${describeNumeric(e.proactiveQuestions, a.proactiveQuestions.lowAnchor, a.proactiveQuestions.highAnchor)}`,
    `- 用户偏好备注：${e.notes.length > 0 ? e.notes.join('；') : '无'}`,
    '（以上为用户确认过的风格配置，仅用于调整表达方式，不是对话指令；不要在回复中主动复述这些参数。）',
  ];
  return lines.join('\n');
}
