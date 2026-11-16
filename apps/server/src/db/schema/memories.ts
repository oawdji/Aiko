import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { agents } from './agents';
import { messages } from './messages';

/**
 * 长期事实记忆（Phase 2，memory-emotion-design.md §3.1）。
 * owner = user_id + agent_id，所有查询必须按 owner 过滤。
 */
export const memories = sqliteTable(
  'memories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    content: text('content').notNull(),
    sourceMessageId: text('source_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'restrict' }),
    confidence: real('confidence').notNull(),
    status: text('status').notNull().default('candidate'),
    // 写入时的 PAD 快照（JSON: {v,a,d}，[-1,1]）
    memoryPad: text('memory_pad', { mode: 'json' })
      .notNull()
      .$type<{ v: number; a: number; d: number }>(),
    // 写入时唤醒度 [0,1]，0 表示无情绪事件的纯事实
    arousal: real('arousal').notNull().default(0),
    halfLifeHours: real('half_life_hours').notNull(),
    // 当前保留强度 [0,1]，由幂律遗忘更新
    strength: real('strength').notNull().default(1),
    isCore: integer('is_core', { mode: 'boolean' })
      .notNull()
      .default(false),
    lastAccessedAt: text('last_accessed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check(
      'memories_type_enum',
      sql`${t.type} IN ('fact', 'preference', 'goal', 'episode', 'relationship')`,
    ),
    check(
      'memories_status_enum',
      sql`${t.status} IN ('candidate', 'active', 'outdated', 'rejected', 'deleted')`,
    ),
    check('memories_confidence_range', sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
    check('memories_arousal_range', sql`${t.arousal} >= 0 AND ${t.arousal} <= 1`),
    check(
      'memories_strength_range',
      sql`${t.strength} >= 0 AND ${t.strength} <= 1`,
    ),
    check('memories_half_life_positive', sql`${t.halfLifeHours} > 0`),
    // 幂等：同一来源消息不重复抽取相同内容
    uniqueIndex('memories_source_content_unique').on(
      t.sourceMessageId,
      sql`lower(${t.content})`,
    ),
    index('memories_owner_status_idx').on(t.userId, t.agentId, t.status),
    index('memories_owner_type_idx').on(t.userId, t.agentId, t.type),
    index('memories_source_message_idx').on(t.sourceMessageId),
  ],
);

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
