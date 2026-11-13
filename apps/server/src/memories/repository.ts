import { and, eq, sql } from 'drizzle-orm';
import {
  type MemoryFactDTO,
  type MemoryListQuery,
  type MemoryStatus,
  type MemoryType,
} from '@aiko/shared';
import type { DbHandle } from '../db/client';
import { memories, type Memory, type NewMemory } from '../db/schema';

/**
 * memories repository：memories 表的唯一 SQL 出入口（memory-emotion-design.md §一）。
 * 所有查询必须带 owner（userId + agentId），本模块不提供无 owner 的读取路径。
 */
export type MemoryOwner = { userId: string; agentId: string };

export function toDto(row: Memory): MemoryFactDTO {
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    type: row.type as MemoryType,
    content: row.content,
    sourceMessageId: row.sourceMessageId,
    confidence: row.confidence,
    status: row.status as MemoryStatus,
    memoryPad: row.memoryPad,
    arousal: row.arousal,
    halfLifeHours: row.halfLifeHours,
    strength: row.strength,
    lastAccessedAt: row.lastAccessedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function insertMemory(handle: DbHandle, values: NewMemory): Memory {
  return handle.db.insert(memories).values(values).returning().get();
}

export function findMemoryById(
  handle: DbHandle,
  owner: MemoryOwner,
  id: string,
): Memory | undefined {
  return handle.db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.id, id),
        eq(memories.userId, owner.userId),
        eq(memories.agentId, owner.agentId),
      ),
    )
    .get();
}

export function listMemories(
  handle: DbHandle,
  owner: MemoryOwner,
  query: MemoryListQuery,
): MemoryFactDTO[] {
  const conditions = [
    eq(memories.userId, owner.userId),
    eq(memories.agentId, owner.agentId),
  ];
  if (query.status) conditions.push(eq(memories.status, query.status));
  if (query.type) conditions.push(eq(memories.type, query.type));

  const rows = handle.db
    .select()
    .from(memories)
    .where(and(...conditions))
    .orderBy(sql`${memories.createdAt} desc`)
    .limit(query.limit)
    .offset(query.offset)
    .all();
  return rows.map(toDto);
}

export function updateMemoryRow(
  handle: DbHandle,
  id: string,
  patch: Partial<Pick<Memory, 'content' | 'type' | 'status' | 'updatedAt'>>,
): Memory {
  return handle.db
    .update(memories)
    .set(patch)
    .where(eq(memories.id, id))
    .returning()
    .get();
}

export type SameTypeActiveMemory = Pick<
  Memory,
  'id' | 'content' | 'confidence' | 'strength'
>;

/** 同 owner + 同 type 的 active 记忆（冲突处理用，F16）。 */
export function listActiveByType(
  handle: DbHandle,
  owner: MemoryOwner,
  type: MemoryType,
): SameTypeActiveMemory[] {
  return handle.db
    .select({
      id: memories.id,
      content: memories.content,
      confidence: memories.confidence,
      strength: memories.strength,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, owner.userId),
        eq(memories.agentId, owner.agentId),
        eq(memories.type, type),
        eq(memories.status, 'active'),
      ),
    )
    .all();
}

export function markOutdated(handle: DbHandle, ids: string[], now: string): void {
  if (ids.length === 0) return;
  handle.sqlite
    .prepare(
      `UPDATE memories SET status = 'outdated', updated_at = ?
       WHERE id IN (${ids.map(() => '?').join(',')}) AND status = 'active'`,
    )
    .run(now, ...ids);
}
