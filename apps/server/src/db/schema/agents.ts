import { sql } from 'drizzle-orm';
import { check, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    currentValence: real('current_valence').notNull(),
    currentArousal: real('current_arousal').notNull(),
    currentTag: text('current_tag').notNull(),
    stateUpdatedAt: text('state_updated_at'),
    activePersonaVersion: integer('active_persona_version').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check(
      'agents_current_valence_range',
      sql`${t.currentValence} >= -1 AND ${t.currentValence} <= 1`,
    ),
    check(
      'agents_current_arousal_range',
      sql`${t.currentArousal} >= -1 AND ${t.currentArousal} <= 1`,
    ),
    check(
      'agents_current_tag_enum',
      sql`${t.currentTag} IN ('calm', 'curious', 'happy', 'low', 'tense', 'neutral')`,
    ),
    check(
      'agents_active_persona_version_min',
      sql`${t.activePersonaVersion} >= 1`,
    ),
  ],
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;