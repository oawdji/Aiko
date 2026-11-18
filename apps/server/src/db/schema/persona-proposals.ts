import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { agents } from './agents';

export const personaProposals = sqliteTable(
  'persona_proposals',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** 提案基于的活跃版本（approve 时做并发守卫） */
    baseVersion: integer('base_version').notNull(),
    requestText: text('request_text').notNull(),
    /** 结构化补丁（strict 白名单 JSON），不是自由文本 */
    patchJson: text('patch_json').notNull(),
    diffSummary: text('diff_summary').notNull(),
    status: text('status').notNull().default('pending'),
    source: text('source').notNull().default('user_request'),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    reviewedAt: text('reviewed_at'),
  },
  (t) => [
    check(
      'persona_proposals_status_enum',
      sql`${t.status} IN ('pending', 'approved', 'rejected', 'expired')`,
    ),
    check(
      'persona_proposals_source_enum',
      sql`${t.source} IN ('user_request', 'system_observed', 'rollback')`,
    ),
    check(
      'persona_proposals_base_version_min',
      sql`${t.baseVersion} >= 1`,
    ),
    index('persona_proposals_agent_status_idx').on(t.agentId, t.status),
    index('persona_proposals_agent_created_idx').on(t.agentId, t.createdAt),
  ],
);

export type PersonaProposal = typeof personaProposals.$inferSelect;
export type NewPersonaProposal = typeof personaProposals.$inferInsert;
