import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { relationshipDimensions } from '../db/schema';

/**
 * 关系维度引擎（多元关系）：
 * - 7 个维度：信任/熟悉/亲密/乐趣/依赖 + 负面维度 紧张/心结；
 * - LLM 只做事件分类（classify.ts），数值由本文件的规则表确定性应用——
 *   防止"模型给自己的关系刷分"（业界共识，参考 RP Suite）；
 * - 单日变化上限防刷（每个维度每天 |Δ| ≤ 0.3）。
 */

export const DIMENSION_KEYS = [
  'trust',
  'familiarity',
  'closeness',
  'fun',
  'dependency',
  'tension',
  'grudge',
] as const;

export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export type DimensionState = {
  agentId: string;
  trust: number;
  familiarity: number;
  closeness: number;
  fun: number;
  dependency: number;
  tension: number;
  grudge: number;
  impression: string;
  reason: string;
  updatedAt: string;
};

/** 初始值：新认识时低分起步——第一面也会有一点"眼缘"，但陌生就是陌生。 */
export const INITIAL_DIMENSIONS: Record<DimensionKey, number> = {
  trust: 0.2,
  familiarity: 0.1,
  closeness: 0.15,
  fun: 0.2,
  dependency: 0.05,
  tension: 0,
  grudge: 0,
};

/** 事件 → 维度增量规则表（确定性，可单测）。 */
export const EVENT_RULES: Record<string, Partial<Record<DimensionKey, number>> & { label: string }> = {
  deep_share: { label: '深入分享', trust: 0.08, closeness: 0.04 },
  conflict: { label: '冲突', trust: -0.12, fun: -0.1, tension: 0.2, grudge: 0.15 },
  apology: { label: '道歉修复', trust: 0.1, tension: -0.15, grudge: -0.1 },
  promise_kept: { label: '承诺兑现', trust: 0.1 },
  fun_interaction: { label: '有趣互动', fun: 0.1, closeness: 0.03, tension: -0.05 },
  ignored: { label: '被冷落', fun: -0.08, grudge: 0.05, dependency: -0.05 },
  emotional_support: { label: '情感支持', trust: 0.06, closeness: 0.05, dependency: 0.04 },
  smalltalk: { label: '日常闲聊', familiarity: 0.02, fun: 0.01 },
};

/** 每维度每天 |Δ| 上限（防一次刷满）。 */
export const DAILY_CAP = 0.3;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export type DimensionRow = {
  agentId: string;
  trust: number;
  familiarity: number;
  closeness: number;
  fun: number;
  dependency: number;
  tension: number;
  grudge: number;
  impression: string;
  reason: string;
  evalMessageCount: number;
  changeDate: string | null;
  dailyChangesJson: string;
  updatedAt: string;
};

/** 读取维度状态；无行时返回初始默认（不落库，落库发生在首次应用事件时）。 */
export function getDimensionState(handle: DbHandle, agentId: string): DimensionRow {
  const row = handle.db
    .select()
    .from(relationshipDimensions)
    .where(eq(relationshipDimensions.agentId, agentId))
    .get();
  if (row) return row;
  return {
    agentId,
    trust: INITIAL_DIMENSIONS.trust,
    familiarity: INITIAL_DIMENSIONS.familiarity,
    closeness: INITIAL_DIMENSIONS.closeness,
    fun: INITIAL_DIMENSIONS.fun,
    dependency: INITIAL_DIMENSIONS.dependency,
    tension: INITIAL_DIMENSIONS.tension,
    grudge: INITIAL_DIMENSIONS.grudge,
    impression: '',
    reason: '',
    evalMessageCount: 0,
    changeDate: null,
    dailyChangesJson: '{}',
    updatedAt: '',
  };
}

export function setImpression(handle: DbHandle, agentId: string, impression: string, now: string): void {
  handle.db
    .update(relationshipDimensions)
    .set({ impression, updatedAt: now })
    .where(eq(relationshipDimensions.agentId, agentId))
    .run();
}

/**
 * 应用事件效果（确定性规则引擎）：
 * - 单日变化上限：跨天重置计数；同维度当日 |Δ| 超过 DAILY_CAP 的部分被截断；
 * - 维度 clamp 到 [0,1]；
 * - 更新 reason 为本次事件标签。
 */
export function applyEventEffects(
  handle: DbHandle,
  agentId: string,
  events: string[],
  now: string,
): DimensionRow {
  const current = getDimensionState(handle, agentId);
  const localDate = now.slice(0, 10);
  const sameDay = current.changeDate === localDate;
  let daily: Record<string, number> = {};
  try {
    const parsed: unknown = JSON.parse(sameDay ? current.dailyChangesJson : '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      daily = parsed as Record<string, number>;
    }
  } catch {
    daily = {};
  }

  const values: Record<DimensionKey, number> = {
    trust: current.trust,
    familiarity: current.familiarity,
    closeness: current.closeness,
    fun: current.fun,
    dependency: current.dependency,
    tension: current.tension,
    grudge: current.grudge,
  };

  const appliedLabels: string[] = [];
  for (const event of events) {
    const rule = EVENT_RULES[event];
    if (!rule) continue;
    appliedLabels.push(rule.label);
    for (const key of DIMENSION_KEYS) {
      const delta = (rule as Partial<Record<DimensionKey, number>>)[key];
      if (delta === undefined) continue;
      const usedToday = sameDay ? (daily[key] ?? 0) : 0;
      const room = Math.max(0, DAILY_CAP - usedToday);
      const applied = Math.sign(delta) * Math.min(Math.abs(delta), room);
      if (applied === 0) continue;
      values[key] = clamp01(values[key] + applied);
      daily[key] = usedToday + Math.abs(applied);
    }
  }

  // 注意：此处使用原生 upsert。drizzle 的 onConflictDoUpdate 会生成带表名限定的
  // 冲突目标（`on conflict ("table"."col")`），SQLite 不接受该写法且语句静默无效。
  handle.sqlite
    .prepare(
      `INSERT INTO relationship_dimensions
        (agent_id, trust, familiarity, closeness, fun, dependency, tension, grudge,
         reason, eval_message_count, change_date, daily_changes_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (agent_id) DO UPDATE SET
         trust = excluded.trust,
         familiarity = excluded.familiarity,
         closeness = excluded.closeness,
         fun = excluded.fun,
         dependency = excluded.dependency,
         tension = excluded.tension,
         grudge = excluded.grudge,
         reason = excluded.reason,
         eval_message_count = excluded.eval_message_count,
         change_date = excluded.change_date,
         daily_changes_json = excluded.daily_changes_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      agentId,
      values.trust,
      values.familiarity,
      values.closeness,
      values.fun,
      values.dependency,
      values.tension,
      values.grudge,
      appliedLabels.length > 0 ? appliedLabels.join(' · ') : current.reason,
      current.evalMessageCount,
      localDate,
      JSON.stringify(daily),
      now,
    );

  return getDimensionState(handle, agentId);
}