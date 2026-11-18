import { desc, eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { messages, proactiveMessages } from '../db/schema';

/** 最新一次显著负面情绪事件（valence <= 阈值，且已沉淀超过 maxAgeMs）。 */
export function getLatestNegativeStateEvent(
  handle: DbHandle,
  agentId: string,
  threshold: number,
  maxAgeMs: number,
  nowMs: number,
): { valence: number; createdAt: string } | null {
  const cutoff = new Date(nowMs - maxAgeMs).toISOString();
  const row = handle.sqlite
    .prepare(
      "SELECT after_valence AS valence, created_at FROM state_events WHERE agent_id = ? AND after_valence <= ? AND created_at <= ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(agentId, threshold, cutoff) as { valence: number; created_at: string } | undefined;
  return row ? { valence: row.valence, createdAt: row.created_at } : null;
}

/** 可回想的记忆：active 且足够“久”（创建与最近访问都早于阈值），随机取 5 条。 */
export function getRecallableMemories(
  handle: DbHandle,
  agentId: string,
  minAgeMs: number,
  nowMs: number,
): Array<{ id: string; content: string }> {
  const cutoff = new Date(nowMs - minAgeMs).toISOString();
  return handle.sqlite
    .prepare(
      "SELECT id, content FROM memories WHERE agent_id = ? AND status = 'active' AND created_at <= ? AND (last_accessed_at IS NULL OR last_accessed_at <= ?) ORDER BY RANDOM() LIMIT 5",
    )
    .all(agentId, cutoff, cutoff) as Array<{ id: string; content: string }>;
}

export function getLastUserMessage(handle: DbHandle, conversationId: string): string | null {
  const row = handle.sqlite
    .prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get(conversationId) as { content: string } | undefined;
  return row?.content ?? null;
}

export function getLastUserMessageAtMs(handle: DbHandle, conversationId: string): number | null {
  const row = handle.sqlite
    .prepare(
      "SELECT created_at FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get(conversationId) as { created_at: string } | undefined;
  return row ? Date.parse(row.created_at) : null;
}

export function getLastProactiveAtMs(handle: DbHandle, agentId: string): number | null {
  const row = handle.sqlite
    .prepare('SELECT created_at FROM proactive_messages WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(agentId) as { created_at: string } | undefined;
  return row ? Date.parse(row.created_at) : null;
}

export function countProactive24h(handle: DbHandle, agentId: string, sinceIso: string): number {
  const row = handle.sqlite
    .prepare('SELECT COUNT(*) AS n FROM proactive_messages WHERE agent_id = ? AND created_at >= ?')
    .get(agentId, sinceIso) as { n: number };
  return row.n;
}

export function hasEmotionCareSince(
  handle: DbHandle,
  agentId: string,
  maxAgeMs: number,
  nowMs: number,
): boolean {
  const cutoff = new Date(nowMs - maxAgeMs).toISOString();
  const row = handle.sqlite
    .prepare(
      "SELECT 1 FROM proactive_messages WHERE agent_id = ? AND strategy = 'emotion_care' AND created_at >= ? LIMIT 1",
    )
    .get(agentId, cutoff);
  return row !== undefined;
}

export function insertProactiveAudit(
  handle: DbHandle,
  values: {
    id: string;
    agentId: string;
    conversationId: string;
    messageId: string;
    strategy: string;
    reason: string;
    evidenceText: string;
    createdAt: string;
  },
): void {
  handle.db.insert(proactiveMessages).values(values).run();
}

/** 主动消息历史（含正文，join messages；级联删除保证一致）。 */
export function listProactiveHistory(
  handle: DbHandle,
  agentId: string,
  limit: number,
): Array<{
  id: string;
  conversationId: string;
  strategy: string;
  evidenceText: string;
  createdAt: string;
  content: string;
}> {
  const rows = handle.db
    .select({
      id: proactiveMessages.id,
      conversationId: proactiveMessages.conversationId,
      strategy: proactiveMessages.strategy,
      evidenceText: proactiveMessages.evidenceText,
      createdAt: proactiveMessages.createdAt,
      content: messages.content,
    })
    .from(proactiveMessages)
    .innerJoin(messages, eq(messages.id, proactiveMessages.messageId))
    .where(eq(proactiveMessages.agentId, agentId))
    .orderBy(desc(proactiveMessages.createdAt))
    .limit(limit)
    .all();
  return rows;
}
