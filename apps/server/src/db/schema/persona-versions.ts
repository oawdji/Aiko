import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { agents } from './agents';

export const personaVersions = sqliteTable(
  'persona_versions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    personaCoreMd: text('persona_core_md').notNull(),
    personaCoreHash: text('persona_core_hash').notNull(),
    evolvableJson: text('evolvable_json').notNull(),
    isActive: integer('is_active').notNull().default(0),
    createdAt: text('created_at').notNull(),
    activatedAt: text('activated_at'),
  },
  (t) => [
    check('persona_versions_version_min', sql`${t.version} >= 1`),
    check('persona_versions_is_active_flag', sql`${t.isActive} IN (0, 1)`),
    check(
      'persona_versions_evolvable_json_valid',
      sql`json_valid(${t.evolvableJson})`,
    ),
    unique('persona_versions_agent_version_unique').on(t.agentId, t.version),
    // database-schema.md §5.5 推荐增强：同一 Agent 只允许一条 active 版本
    uniqueIndex('persona_versions_one_active_idx')
      .on(t.agentId)
      .where(sql`${t.isActive} = 1`),
    index('persona_versions_agent_version_idx').on(
      t.agentId,
      sql`${t.version} desc`,
    ),
  ],
);

export type PersonaVersion = typeof personaVersions.$inferSelect;
export type NewPersonaVersion = typeof personaVersions.$inferInsert;