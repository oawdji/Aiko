import { desc, eq, sql } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { messages } from '../db/schema';
import {
  applyEventEffects,
  setImpression,
  getDimensionState,
  type DimensionRow,
} from './dimensions';
import { publishEvent } from '../plugins/event-bus';

/**
 * 关系自省（Phase：多元关系）：
 * - LLM 不打分，只做事件分类（业界共识：模型会给自己的关系刷分）；
 * - 每 10 条新用户消息触发一次（eval_message_count 节流，惰性 fire-and-forget）；
 * - 数值由 EVENT_RULES 规则表确定性应用；分类失败保持原状态。
 */

const CLASSIFY_SYSTEM_PROMPT = [
  '你是关系观察器。分析给定的最近对话，输出 JSON：',
  '{"events":["..."],"impression":"Aiko 对用户的一两句第一人称印象"}。',
  'events 只能从以下标签选择：deep_share(深入分享脆弱话题), conflict(冲突或争执),',
  'apology(道歉或修复), promise_kept(承诺被兑现), fun_interaction(有趣互动或玩梗),',
  'ignored(用户长时间冷淡或敷衍), emotional_support(情感支持), smalltalk(日常闲聊)。',
  '没有可识别事件时 events 为空数组。impression 基于对话内容概括，不要复述事件列表。',
].join('\n');

const EVAL_THRESHOLD = 10;

export type RelationshipEvent =
  | 'deep_share'
  | 'conflict'
  | 'apology'
  | 'promise_kept'
  | 'fun_interaction'
  | 'ignored'
  | 'emotional_support'
  | 'smalltalk';

const VALID_EVENTS = new Set<string>([
  'deep_share',
  'conflict',
  'apology',
  'promise_kept',
  'fun_interaction',
  'ignored',
  'emotional_support',
  'smalltalk',
]);

export type DiaryCompleteFnLike = (input: { system: string; prompt: string }) => Promise<string>;

function totalUserTurns(handle: DbHandle, agentId: string): number {
  const row = handle.db
    .select({ n: sql<number>`COUNT(*)` })
    .from(messages)
    .where(sql`${messages.agentId} = ${agentId} AND ${messages.role} = 'user' AND ${messages.status} = 'complete'`)
    .get();
  return row?.n ?? 0;
}

function recentTranscript(handle: DbHandle, agentId: string, limit: number): string {
  const rows = handle.db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(sql`${messages.agentId} = ${agentId} AND ${messages.status} = 'complete'`)
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit)
    .all()
    .reverse();
  return rows.map((m) => `${m.role}: ${m.content}`).join('\n');
}

/** 默认补全：生效 LLM 配置。 */
export function createDefaultRelationshipComplete(handle: DbHandle): DiaryCompleteFnLike {
  // 延迟 import 防止 settings/llm 依赖环
  return async ({ system, prompt }) => {
    const { resolveEffectiveLlmSettings } = await import('../settings/service');
    const { getChatModel } = await import('../llm/provider');
    const { generateText } = await import('ai');
    const settings = resolveEffectiveLlmSettings(handle);
    if (!settings.apiKey) {
      throw new Error('LLM API key is not configured');
    }
    const result = await generateText({
      model: getChatModel({
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
      }),
      system,
      prompt,
      maxOutputTokens: 150,
    });
    return result.text;
  };
}

function parseClassification(raw: string): { events: RelationshipEvent[]; impression: string | null } {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1]!.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return { events: [], impression: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { events: [], impression: null };
  }
  if (!parsed || typeof parsed !== 'object') return { events: [], impression: null };
  const obj = parsed as { events?: unknown; impression?: unknown };
  const events = Array.isArray(obj.events)
    ? obj.events.filter((v): v is RelationshipEvent => typeof v === 'string' && VALID_EVENTS.has(v))
    : [];
  const impression =
    typeof obj.impression === 'string' && obj.impression.trim() ? obj.impression.trim() : null;
  return { events, impression };
}

export type EvaluateResult = {
  ran: boolean;
  events: RelationshipEvent[];
  skipped?: 'below-threshold' | 'llm-failed';
};

/**
 * 关系自省入口：累计新用户消息 ≥ EVAL_THRESHOLD 时做一次事件分类并应用规则。
 * LLM 失败静默（保持原状态，下次对话重试）。
 */
export async function maybeEvaluateRelationship(
  handle: DbHandle,
  agentId: string,
  conversationId: string,
  now: string,
  complete?: DiaryCompleteFnLike,
): Promise<EvaluateResult> {
  const dims = getDimensionState(handle, agentId);
  const turns = totalUserTurns(handle, agentId);
  if (turns - dims.evalMessageCount < EVAL_THRESHOLD) {
    return { ran: false, events: [], skipped: 'below-threshold' };
  }

  const completeFn =
    complete ?? createDefaultRelationshipComplete(handle);
  let raw: string;
  try {
    raw = await completeFn({
      system: CLASSIFY_SYSTEM_PROMPT,
      prompt: `最近的对话：\n${recentTranscript(handle, agentId, 12) || '（空）'}`,
    });
  } catch {
    return { ran: false, events: [], skipped: 'llm-failed' };
  }

  const { events, impression } = parseClassification(raw);
  const row: DimensionRow = applyEventEffects(handle, agentId, events, now);
  const finalRow = { ...row };
  if (impression) {
    setImpression(handle, agentId, impression, now);
    finalRow.impression = impression;
  }
  // 节流计数推进到当前值
  handle.db
    .update((await import('../db/schema')).relationshipDimensions)
    .set({ evalMessageCount: turns, updatedAt: now })
    .where(eq((await import('../db/schema')).relationshipDimensions.agentId, agentId))
    .run();

  void publishEvent('relationship_updated', {
    agentId,
    trust: finalRow.trust,
    familiarity: finalRow.familiarity,
    closeness: finalRow.closeness,
    fun: finalRow.fun,
    dependency: finalRow.dependency,
    tension: finalRow.tension,
    grudge: finalRow.grudge,
    reason: finalRow.reason,
  });

  return { ran: true, events };
}

void eq;