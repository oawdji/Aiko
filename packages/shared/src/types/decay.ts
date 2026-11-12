/**
 * 基线回归（时间衰减引擎）配置。
 * 公式：x' = μ + (x − μ) · e^(−θ·Δt)，θ = ln2 / halfLifeHours。
 * 见 technical-design.md §10.11。
 */
export type DecayConfig = {
  /** 基线回归半程时间 t½（小时）：每经过 t½，状态到基线的距离减半。 */
  halfLifeHours: number;
  /** 吸附阈值：|x − μ| < epsilon 时视为已回归到基线。 */
  epsilon: number;
};

/** 全局默认半程时间（小时），角色未配置 decay_half_life_hours 时兜底。 */
export const DEFAULT_DECAY_HALF_LIFE_HOURS = 6;

/** 吸附阈值 ε：距离基线小于该值时吸附到 μ，截断长尾。 */
export const DECAY_EPSILON = 0.001;
