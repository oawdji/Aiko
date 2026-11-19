import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { generateText } from 'ai';
import {
  DiaryListResponseSchema,
  type DiaryListResponse,
} from '@aiko/shared';
import type { DbHandle } from '../db/client';
import { diaryEntries, messages, stateEvents } from '../db/schema';
import { resolveEffectiveLlmSettings } from '../settings/service';
import { getChatModel } from '../llm/provider';
import { publishEvent } from '../plugins/event-bus';

/**
 * 日记（虚拟人内心生活，Phase 1）：
 * - 惰性生成：bootstrap 时补写"昨天"的日记（无定时器、不依赖页面打开）；
 * - 只为"昨天确实有对话"的日子生成；LLM 失败静默跳过，下次 bootstrap 重试；
 * - 情绪快照取当天最后一条状态事件的 after 态（无事件回退基线 0/0/0）。
 */

export class DiaryNotFoundError extends Error {
  constructor(id: string) {
    super(`diary not found: ${id}`);
    this.name = 'DiaryNotFoundError';
  }
}

export type DiaryCompleteFn = (input: {
  system: string;
  prompt: string;
}) => Promise<string>;

const DIARY_SYSTEM_PROMPT = [
  '你是 Aiko，一个有稳定人格、分层记忆和可感知情绪的虚拟角色。',
  '请以第一人称写一篇昨天的日记（3-8 句），内容基于给定的当日对话与情绪记录：',
  '记录你们聊了什么、你的情绪如何变化、以及一两句你自己的想法或好奇。',
  '语气自然、像真人写日记；不要罗列数据数值；不要提及"系统""prompt""LLM"等词。',
  '直接输出日记正文，不要标题、日期或任何前后缀。',
].join('\n');

export type DiaryGenerateDeps = {
  complete?: DiaryCompleteFn;
};

/** 本地时区 YYYY-MM-DD（服务器运行在用户本机，本地时区即用户时区）。 */
function localDateString(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${iso}`);
  return d.toLocaleDateString('sv-SE');
}

function dayBounds(date: string): { startIso: string; endIso: string } {
  // date 为本地 YYYY-MM-DD；构造本地零点 → ISO
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T23:59:59.999`);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function hasDiaryForDate(handle: DbHandle, agentId: string, date: string): boolean {
  return !!handle.db
    .select({ id: diaryEntries.id })
    .from(diaryEntries)
    .where(
      and(
        eq(diaryEntries.agentId, agentId),
        eq(diaryEntries.date, date),
        eq(diaryEntries.type, 'daily'),
      ),
    )
    .get();
}

function hasMessagesOnDate(handle: DbHandle, agentId: string, date: string): boolean {
  const { startIso, endIso } = dayBounds(date);
  const row = handle.db
    .select({ id: messages.id })
    .from(messages)
    .where(
      sql`${messages.agentId} = ${agentId} AND ${messages.createdAt} >= ${startIso} AND ${messages.createdAt} <= ${endIso}`,
    )
    .get();
  return !!row;
}

type DayMood = {
  valence: number;
  arousal: number;
  dominance: number;
} | null;

function moodSnapshotForDate(handle: DbHandle, agentId: string, date: string): DayMood {
  const { startIso, endIso } = dayBounds(date);
  const row = handle.db
    .select({
      valence: stateEvents.afterValence,
      arousal: stateEvents.afterArousal,
      dominance: stateEvents.afterDominance,
    })
    .from(stateEvents)
    .where(
      sql`${stateEvents.agentId} = ${agentId} AND ${stateEvents.createdAt} >= ${startIso} AND ${stateEvents.createdAt} <= ${endIso}`,
    )
    .orderBy(desc(stateEvents.createdAt), desc(stateEvents.id))
    .get();
  if (!row) return null;
  return { valence: row.valence, arousal: row.arousal, dominance: row.dominance };
}

function transcriptForDate(handle: DbHandle, agentId: string, date: string): string {
  const { startIso, endIso } = dayBounds(date);
  const rows = handle.db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(
      sql`${messages.agentId} = ${agentId} AND ${messages.createdAt} >= ${startIso} AND ${messages.createdAt} <= ${endIso}`,
    )
    .orderBy(messages.createdAt, sql`rowid ASC`)
    .all();
  return rows.map((m) => `${m.role}: ${m.content}`).join('\n');
}

/** 默认补全：用生效 LLM 配置做一次最小生成调用。 */
export function createDefaultDiaryComplete(handle: DbHandle): DiaryCompleteFn {
  return async ({ system, prompt }) => {
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
    });
    return result.text;
  };
}

export type EnsureDiaryResult = {
  created: boolean;
  diaryId: string | null;
  reason: 'already-exists' | 'no-messages' | 'generated' | 'llm-failed';
};

/**
 * 惰性补写指定日期（默认昨天）的日记。幂等；LLM 失败静默返回 llm-failed
 * （不落库，下次 bootstrap 自动重试）。
 */
export async function ensureDiaryForDate(
  handle: DbHandle,
  agentId: string,
  date: string,
  now: string,
  deps: DiaryGenerateDeps = {},
): Promise<EnsureDiaryResult> {
  if (hasDiaryForDate(handle, agentId, date)) {
    return { created: false, diaryId: null, reason: 'already-exists' };
  }
  if (!hasMessagesOnDate(handle, agentId, date)) {
    return { created: false, diaryId: null, reason: 'no-messages' };
  }

  const transcript = transcriptForDate(handle, agentId, date);
  const mood = moodSnapshotForDate(handle, agentId, date);
  const moodText = mood
    ? `当天的情绪走向：愉悦度 ${mood.valence.toFixed(2)}，唤醒度 ${mood.arousal.toFixed(2)}，支配度 ${mood.dominance.toFixed(2)}。`
    : '当天没有特别的情绪波动记录。';

  const complete =
    deps.complete ?? createDefaultDiaryComplete(handle);
  let content: string;
  try {
    const raw = await complete({
      system: DIARY_SYSTEM_PROMPT,
      prompt: `日期：${date}\n${moodText}\n\n当天的对话记录：\n${transcript}`,
    });
    content = raw.trim();
  } catch {
    return { created: false, diaryId: null, reason: 'llm-failed' };
  }
  if (!content) {
    return { created: false, diaryId: null, reason: 'llm-failed' };
  }

  const id = `diary_${randomUUID()}`;
  handle.db
    .insert(diaryEntries)
    .values({
      id,
      agentId,
      date,
      type: 'daily',
      content,
      moodValence: mood?.valence ?? null,
      moodArousal: mood?.arousal ?? null,
      moodDominance: mood?.dominance ?? null,
      source: 'auto',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  void publishEvent('diary_created', { agentId, diaryId: id, date });
  return { created: true, diaryId: id, reason: 'generated' };
}

/** bootstrap 惰性入口：补写昨天的日记（fire-and-forget，失败仅日志）。 */
export async function ensureYesterdayDiary(
  handle: DbHandle,
  agentId: string,
  nowIso: string,
  deps: DiaryGenerateDeps = {},
): Promise<EnsureDiaryResult> {
  const yesterday = localDateString(
    new Date(Date.parse(nowIso) - 24 * 3600_000).toISOString(),
  );
  const result = await ensureDiaryForDate(handle, agentId, yesterday, nowIso, deps);
  if (result.reason === 'llm-failed') {
    console.warn('[diary] yesterday diary generation failed, will retry next bootstrap');
  }
  return result;
}

// ---------------------------------------------------------------------------
// 查询 / 删除（日记面板用）
// ---------------------------------------------------------------------------

export function listDiaryEntries(
  handle: DbHandle,
  query: { type?: 'daily' | 'thought'; limit?: number; offset?: number } = {},
): DiaryListResponse {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const conditions = [];
  if (query.type) conditions.push(eq(diaryEntries.type, query.type));
  const filter = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = handle.db
    .select()
    .from(diaryEntries)
    .where(filter)
    .orderBy(desc(diaryEntries.date), desc(diaryEntries.createdAt))
    .all();
  const total = rows.length;
  const items = rows.slice(offset, offset + limit).map((row) => ({
    id: row.id,
    agentId: row.agentId,
    date: row.date,
    type: row.type as 'daily' | 'thought',
    content: row.content,
    mood:
      row.moodValence !== null && row.moodArousal !== null && row.moodDominance !== null
        ? { valence: row.moodValence, arousal: row.moodArousal, dominance: row.moodDominance }
        : null,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
  return DiaryListResponseSchema.parse({ items, total });
}

export function deleteDiaryEntry(handle: DbHandle, id: string): { ok: true; deletedAt: string } {
  const row = handle.db.select().from(diaryEntries).where(eq(diaryEntries.id, id)).get();
  if (!row) {
    throw new DiaryNotFoundError(id);
  }
  handle.db.delete(diaryEntries).where(eq(diaryEntries.id, id)).run();
  return { ok: true, deletedAt: new Date().toISOString() };
}