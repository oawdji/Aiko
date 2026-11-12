import type { AgentEmotionState, EmotionTag } from '@aiko/shared';

/**
 * 生成注入 system prompt 的情绪状态行（technical-design.md §10.11）。
 * 独立小模块：service.ts 只做组装，避免继续膨胀。
 */
export function buildEmotionPromptLine(state: AgentEmotionState, tag: EmotionTag): string {
  const fmt = (n: number) => n.toFixed(2);
  return [
    '【当前情绪状态】',
    `标签：${tag}`,
    `愉悦度 ${fmt(state.valence)} / 唤醒度 ${fmt(state.arousal)} / 支配度 ${fmt(state.dominance)}`,
    '请保持人设一致，自然体现该情绪状态，不要直接复述这些数值。',
  ].join('\n');
}
