/**
 * 唤醒度显著性门控（memory-emotion-design.md §4.3）。
 * 纯函数：half_life = base × (1 + arousal)。
 * base 参数治理进 app_settings 是 S4 的事，本期先用默认常量。
 */
export const MEMORY_BASE_HALF_LIFE_HOURS = 72;

/** arousal 标定上限：超过按 1 处理（半衰期 × 2 封顶）。 */
export function computeHalfLifeHours(
  baseHours: number = MEMORY_BASE_HALF_LIFE_HOURS,
  arousal: number,
): number {
  const a = Math.max(0, Math.min(1, arousal));
  return baseHours * (1 + a);
}
