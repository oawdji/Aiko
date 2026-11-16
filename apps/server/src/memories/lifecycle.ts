import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { conversationSummaries, memories, messages } from '../db/schema';
import type { DbHandle } from '../db/client';
import type { MemoryOwner } from './repository';
import type { CompleteFn } from '../extraction/types';

/**
 * 记忆生命周期（memory-emotion-design.md §6）：
 * - 幂律遗忘：strength(t) = (1 + Δt/half_life)^(-β)，只影响检索权重不删除数据；
 * - 核心记忆地板：不衰减到 0.2 以下；
 * - 再巩固：被检索的记忆 arousal + η，按 base 不变原则重算 half_life；
 * - 摘要：每 30 条消息触发 pending 任务，LLM 异步生成，幂等可重试。
 * 全部常量显式导出（app_settings 治理后续统一做）。
 */

export const FORGETTING_BETA_POWER = 0.5;
export const CORE_STRENGTH_FLOOR = 0.2;
export const RECONSOLIDATION_ETA = 0.05;
export const AROUSAL_CAP = 0.95;
export const SUMMARY_MESSAGE_THRESHOLD = 30;

export function computeStrength(params: {
  createdAtIso: string;
  nowIso: string;
  halfLifeHours: number;
  isCore?: boolean;
  betaPower?: number;
  floor?: number;
}): number {
  const beta = params.betaPower ?? FORGETTING_BETA_POWER;
  const dt = Math.max(
    0,
    (Date.parse(params.nowIso) - Date.parse(params.createdAtIso)) / 3_600_000,
  );
  const s = Math.pow(1 + dt / Math.max(1e-6, params.halfLifeHours), -beta);
  const floored = params.isCore
    ? Math.max(s, params.floor ?? CORE_STRENGTH_FLOOR)
    : s;
  return Math.max(0, Math.min(1, floored));
}

/**
 * 再巩固（§6.2）：检索命中 arousal += η（上限 0.95），
 * half_life 重算保持 base 不变：half' = half / (1+arousal) × (1+arousal')。
 */
export function reconsolidate(
  arousal: number,
  halfLifeHours: number,
  eta: number = RECONSOLIDATION_ETA,
  cap: number = AROUSAL_CAP,
): { arousal: number; halfLifeHours: number } {
  const nextArousal = Math.min(cap, arousal + eta);
  const base = halfLifeHours / (1 + arousal);
  return { arousal: nextArousal, halfLifeHours: base * (1 + nextArousal) };
}

/** 惰性批量刷新 owner 范围内所有未删除记忆的 strength（读路径调用）。 */
export function refreshStrengths(
  handle: DbHandle,
  owner: MemoryOwner,
  nowIso: string,
): number {
  const rows = handle.db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, owner.userId),
        eq(memories.agentId, owner.agentId),
        ne(memories.status, 'deleted'),
      ),
    )
    .all();
  let updated = 0;
  for (const row of rows) {
    const next = computeStrength({
      createdAtIso: row.createdAt,
      nowIso,
      halfLifeHours: row.halfLifeHours,
      isCore: row.isCore,
    });
    if (Math.abs(next - row.strength) > 1e-6) {
      handle.db
        .update(memories)
        .set({ strength: next, updatedAt: nowIso })
        .where(eq(memories.id, row.id))
        .run();
      updated += 1;
    }
  }
  return updated;
}

/** 检索命中后的再巩固写回（chat pipeline fire-and-forget 调用）。 */
export function reconsolidateHits(
  handle: DbHandle,
  ids: string[],
  nowIso: string,
): void {
  if (ids.length === 0) return;
  const rows = handle.db.select().from(memories).where(inArray(memories.id, ids)).all();
  for (const row of rows) {
    if (row.status !== 'active') continue;
    const next = reconsolidate(row.arousal, row.halfLifeHours);
    handle.db
      .update(memories)
      .set({ arousal: next.arousal, halfLifeHours: next.halfLifeHours, updatedAt: nowIso })
      .where(eq(memories.id, row.id))
      .run();
  }
}

export type SummaryTriggerResult = {
  triggered: boolean;
  summaryId: string | null;
  messageCount: number;
};

/**
 * 摘要触发（F14）：自上次摘要范围之后新增 ≥ 30 条消息时创建 pending 任务。
 * 幂等：pending 任务已存在时不重复创建。
 */
export function maybeTriggerSummary(
  handle: DbHandle,
  conversationId: string,
  agentId: string,
  nowIso: string,
  threshold: number = SUMMARY_MESSAGE_THRESHOLD,
): SummaryTriggerResult {
  const last = handle.db
    .select()
    .from(conversationSummaries)
    .where(
      and(
        eq(conversationSummaries.conversationId, conversationId),
        ne(conversationSummaries.status, 'deleted'),
      ),
    )
    .orderBy(sql`${conversationSummaries.createdAt} desc`)
    .get();

  const all = handle.db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .all();
  const startIdx = last ? all.findIndex((m) => m.id === last.endMessageId) + 1 : 0;
  const newMessages = all.slice(startIdx);
  if (newMessages.length < threshold) {
    return { triggered: false, summaryId: null, messageCount: newMessages.length };
  }

  const id = `sum_${randomUUID()}`;
  handle.db
    .insert(conversationSummaries)
    .values({
      id,
      conversationId,
      agentId,
      startMessageId: newMessages[0]!.id,
      endMessageId: newMessages[newMessages.length - 1]!.id,
      content: '',
      status: 'pending',
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .run();
  return { triggered: true, summaryId: id, messageCount: newMessages.length };
}

/** 摘要 prompt（F14）：压缩一段对话为简洁摘要，主语为「用户」。 */
export const SUMMARY_SYSTEM_PROMPT = [
  '你是会话摘要器。把给定的对话消息压缩为 3-5 句简洁摘要，',
  '重点保留用户的事实、偏好、目标和事件，忽略寒暄。',
  '直接输出摘要文本，不要任何前后缀。',
].join('\n');

/** 执行 pending/failed 摘要任务：LLM 生成失败时标 failed（可重试），成功标 ready。 */
export async function runSummaryTask(
  handle: DbHandle,
  summaryId: string,
  complete: CompleteFn,
  nowIso: string,
): Promise<'ready' | 'failed'> {
  const row = handle.db
    .select()
    .from(conversationSummaries)
    .where(eq(conversationSummaries.id, summaryId))
    .get();
  if (!row || row.status === 'ready' || row.status === 'deleted') {
    return row?.status === 'ready' ? 'ready' : 'failed';
  }
  try {
    const startMsg = handle.db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.id, row.startMessageId))
      .get();
    const endMsg = handle.db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.id, row.endMessageId))
      .get();
    const inRange = handle.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, row.conversationId),
          sql`${messages.createdAt} >= ${startMsg?.createdAt ?? ''}`,
          sql`${messages.createdAt} <= ${endMsg?.createdAt ?? ''}`,
        ),
      )
      .orderBy(asc(messages.createdAt))
      .all();
    const transcript = inRange.map((m) => `${m.role}: ${m.content}`).join('\n');
    const text = await complete({
      system: SUMMARY_SYSTEM_PROMPT,
      prompt: transcript || '（空）',
    });
    handle.db
      .update(conversationSummaries)
      .set({ content: text.trim(), status: 'ready', updatedAt: nowIso })
      .where(eq(conversationSummaries.id, summaryId))
      .run();
    return 'ready';
  } catch (error) {
    console.warn('[summary] task failed:', error);
    handle.db
      .update(conversationSummaries)
      .set({ status: 'failed', updatedAt: nowIso })
      .where(eq(conversationSummaries.id, summaryId))
      .run();
    return 'failed';
  }
}
