import { desc, eq } from 'drizzle-orm';
import {
  PromptSnapshotListResponseSchema,
  type PromptSnapshotListResponse,
} from '@aiko/shared';
import type { DbHandle } from '../db/client';
import { promptSnapshots } from '../db/schema';

/**
 * Prompt 快照查询与清理（F36）。
 * 写入侧在 chat service（仅 debug_mode 开启时）；本模块只读 + 清空。
 */

export type PromptSnapshotListQuery = {
  conversationId?: string;
  limit?: number;
  offset?: number;
};

export function listPromptSnapshots(
  handle: DbHandle,
  query: PromptSnapshotListQuery = {},
): PromptSnapshotListResponse {
  const limit = query.limit ?? 20;
  const offset = query.offset ?? 0;
  const filter = query.conversationId
    ? eq(promptSnapshots.conversationId, query.conversationId)
    : undefined;

  const rows = handle.db
    .select()
    .from(promptSnapshots)
    .where(filter)
    .orderBy(desc(promptSnapshots.createdAt), desc(promptSnapshots.id))
    .all();

  const total = rows.length;
  const items = rows.slice(offset, offset + limit).map((row) => {
    let memoryIds: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.memoryIdsJson);
      if (Array.isArray(parsed)) {
        memoryIds = parsed.filter((v): v is string => typeof v === 'string');
      }
    } catch {
      memoryIds = [];
    }
    const windowCount = Number(row.recentWindowCount);
    return PromptSnapshotListResponseSchema.shape.items.element.parse({
      id: row.id,
      conversationId: row.conversationId,
      agentId: row.agentId,
      userMessageId: row.userMessageId,
      systemText: row.systemText,
      memoryIds,
      recentWindowCount: Number.isFinite(windowCount) ? windowCount : 0,
      personaVersion: row.personaVersion,
      createdAt: row.createdAt,
    });
  });
  return PromptSnapshotListResponseSchema.parse({ items, total });
}

export function clearAllPromptSnapshots(handle: DbHandle): {
  ok: true;
  clearedAt: string;
  count: number;
} {
  const count = (
    handle.sqlite.prepare('SELECT COUNT(*) AS n FROM prompt_snapshots').get() as { n: number }
  ).n;
  handle.sqlite.prepare('DELETE FROM prompt_snapshots').run();
  return { ok: true, clearedAt: new Date().toISOString(), count };
}
