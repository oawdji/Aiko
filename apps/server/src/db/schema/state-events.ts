import { sql } from 'drizzle-orm';
import {
  check,
  index,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';
import { agents } from './agents';
import { conversations } from './conversations';
import { messages } from './messages';

export const stateEvents = sqliteTable(
  'state_events',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    triggerMessageId: text('trigger_message_id').references(
      () => messages.id,
      { onDelete: 'restrict' },
    ),
    source: text('source').notNull(),
    ruleVersion: text('rule_version').notNull(),
    beforeValence: real('before_valence').notNull(),
    beforeArousal: real('before_arousal').notNull(),
    beforeDominance: real('before_dominance').notNull().default(0),
    deltaValence: real('delta_valence').notNull(),
    deltaArousal: real('delta_arousal').notNull(),
    deltaDominance: real('delta_dominance').notNull().default(0),
    afterValence: real('after_valence').notNull(),
    afterArousal: real('after_arousal').notNull(),
    afterDominance: real('after_dominance').notNull().default(0),
    discreteTag: text('discrete_tag').notNull(),
    reason: text('reason').notNull(),
    evidenceText: text('evidence_text').notNull(),
    confidence: real('confidence').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check(
      'state_events_source_enum',
      sql`${t.source} IN ('user_message', 'assistant_message', 'time_decay', 'manual')`,
    ),
    check(
      'state_events_before_valence_range',
      sql`${t.beforeValence} >= -1 AND ${t.beforeValence} <= 1`,
    ),
    check(
      'state_events_before_arousal_range',
      sql`${t.beforeArousal} >= -1 AND ${t.beforeArousal} <= 1`,
    ),
    check(
      'state_events_before_dominance_range',
      sql`${t.beforeDominance} >= -1 AND ${t.beforeDominance} <= 1`,
    ),
    check(
      'state_events_delta_valence_range',
      sql`${t.deltaValence} >= -1 AND ${t.deltaValence} <= 1`,
    ),
    check(
      'state_events_delta_arousal_range',
      sql`${t.deltaArousal} >= -1 AND ${t.deltaArousal} <= 1`,
    ),
    check(
      'state_events_delta_dominance_range',
      sql`${t.deltaDominance} >= -1 AND ${t.deltaDominance} <= 1`,
    ),
    check(
      'state_events_after_valence_range',
      sql`${t.afterValence} >= -1 AND ${t.afterValence} <= 1`,
    ),
    check(
      'state_events_after_arousal_range',
      sql`${t.afterArousal} >= -1 AND ${t.afterArousal} <= 1`,
    ),
    check(
      'state_events_after_dominance_range',
      sql`${t.afterDominance} >= -1 AND ${t.afterDominance} <= 1`,
    ),
    check(
      'state_events_confidence_range',
      sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`,
    ),
    check(
      'state_events_discrete_tag_enum',
      sql`${t.discreteTag} IN ('calm', 'curious', 'happy', 'low', 'tense', 'neutral')`,
    ),
    check(
      'state_events_message_trigger_required',
      sql`${t.source} NOT IN ('user_message', 'assistant_message') OR ${t.triggerMessageId} IS NOT NULL`,
    ),
    unique('state_events_trigger_source_rule_unique').on(
      t.triggerMessageId,
      t.source,
      t.ruleVersion,
    ),
    index('state_events_agent_created_idx').on(
      t.agentId,
      sql`${t.createdAt} desc`,
    ),
    index('state_events_conversation_created_idx').on(
      t.conversationId,
      sql`${t.createdAt} desc`,
    ),
    index('state_events_trigger_idx').on(t.triggerMessageId),
  ],
);

export type StateEvent = typeof stateEvents.$inferSelect;
export type NewStateEvent = typeof stateEvents.$inferInsert;