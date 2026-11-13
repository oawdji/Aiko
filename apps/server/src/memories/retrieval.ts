import { and, eq, inArray } from 'drizzle-orm';
import { memories } from '../db/schema';
import { normalizeForFts } from './search-index';
import type { DbHandle } from '../db/client';
import type { MemoryOwner } from './repository';

/**
 * 检索评分（memory-emotion-design.md §5.1）：
 *   score = alpha·sim_sem + beta·sim_aff + gamma·recency
 * sim_sem：FTS5 bm25 rank 归一化（embedding 后补，接口不变）；
 * sim_aff：PAD 三维一致性等权（1 - |delta|/2）；
 * recency：e^(-lambda*dt)，lambda = ln2 / half_life_hours。
 * 参数治理进 app_settings 是 S4 的事，本期用常量 + 显式导出便于测试。
 */

export const RETRIEVAL_WEIGHTS = { alpha: 0.6, beta: 0.3, gamma: 0.1 } as const;
export type MemoryPad3 = { v: number; a: number; d: number };

export type ScoredMemory = {
  id: string;
  content: string;
  type: string;
  score: number;
  parts: { semantic: number; affective: number; recency: number };
};

/** bm25 rank（越小越相关）归一到 [0,1)；无命中为 0。 */
export function scoreSemantic(rank: number | null): number {
  if (rank === null) return 0;
  return 1 / (1 + Math.abs(rank));
}

/** PAD 三维一致性等权，[0,1]。 */
export function scoreAffective(
  current: MemoryPad3 | null,
  memory: MemoryPad3,
): number {
  if (!current) return 0;
  const cons = (a: number, b: number) => 1 - Math.abs(a - b) / 2;
  return (
    (cons(current.v, memory.v) +
      cons(current.a, memory.a) +
      cons(current.d, memory.d)) /
    3
  );
}

/** ACT-R 过渡的指数衰减，[0,1]。 */
export function scoreRecency(
  createdAtIso: string,
  nowIso: string,
  halfLifeHours: number,
): number {
  const dtHours = Math.max(0, (Date.parse(nowIso) - Date.parse(createdAtIso)) / 3_600_000);
  const lambda = Math.log(2) / Math.max(1e-6, halfLifeHours);
  return Math.exp(-lambda * dtHours);
}

function parsePad(raw: unknown): MemoryPad3 {
  const p = (typeof raw === 'string' ? JSON.parse(raw) : raw) as MemoryPad3;
  return { v: p.v, a: p.a, d: p.d };
}

export type SearchOptions = {
  owner: MemoryOwner;
  queryText: string;
  currentPad: MemoryPad3 | null;
  nowIso: string;
  topK?: number;
};

/**
 * 检索 active 记忆：FTS5 召回 → 三信号评分 → Top-K。
 * owner 过滤在 SQL 层强制；candidate/deleted 永不进入候选集。
 */
export function searchMemories(
  handle: DbHandle,
  opts: SearchOptions,
): ScoredMemory[] {
  const topK = opts.topK ?? 5;
  const q = opts.queryText.trim();
  if (!q) return [];

  // FTS5 召回语义候选（rank 由 bm25 计算，越小越相关）
  // FTS5 默认 AND 语义；中文逐字切分后改用 OR，命中任一字符即可召回
  const escaped = normalizeForFts(q)
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/["']/g, ' '))
    .join(' OR ');
  let ftsRows: Array<{ memory_id: string; rank: number }>;
  try {
    ftsRows = handle.sqlite
      .prepare(
        `SELECT memory_id, rank FROM memories_fts
         WHERE memories_fts MATCH ?
         ORDER BY rank LIMIT 20`,
      )
      .all(escaped) as Array<{ memory_id: string; rank: number }>;
  } catch {
    // FTS 语法异常（如纯操作符）按无召回处理
    ftsRows = [];
  }
  if (ftsRows.length === 0) return [];

  const rankById = new Map(ftsRows.map((r) => [r.memory_id, r.rank]));
  const rows = handle.db
    .select()
    .from(memories)
    .where(
      and(
        inArray(memories.id, [...rankById.keys()]),
        eq(memories.userId, opts.owner.userId),
        eq(memories.agentId, opts.owner.agentId),
        eq(memories.status, 'active'),
      ),
    )
    .all();

  const scored = rows.map((row) => {
    const pad = parsePad(row.memoryPad);
    const semantic = scoreSemantic(rankById.get(row.id) ?? null);
    const affective = scoreAffective(opts.currentPad, pad);
    const recency = scoreRecency(row.createdAt, opts.nowIso, row.halfLifeHours);
    const { alpha, beta, gamma } = RETRIEVAL_WEIGHTS;
    // 无情感查询时情感项按中性 0.5 计，避免系统性压低分数
    const aff = opts.currentPad ? affective : 0.5;
    const score = alpha * semantic + beta * aff + gamma * recency;
    return {
      id: row.id,
      content: row.content,
      type: row.type,
      score,
      parts: { semantic, affective, recency },
    } satisfies ScoredMemory;
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** 再巩固入口（§6.2 S4 用）：命中即刷新 last_accessed_at。 */
export function updateLastAccessed(handle: DbHandle, ids: string[], nowIso: string): void {
  if (ids.length === 0) return;
  handle.db
    .update(memories)
    .set({ lastAccessedAt: nowIso })
    .where(inArray(memories.id, ids))
    .run();
}
