import { check, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * 关系维度状态（成长体验 Phase：多元关系）。
 *
 * 设计原则（调查结论：参考 Affinity Agent / RP Suite）：
 * - 多维含负面维度（tension/grudge），让"冲突→道歉→修复"的关系动态有意义；
 * - LLM 不打分——只做事件分类（deep_share/conflict/apology/...），
 *   数值由规则表确定性应用（防止模型给自己刷好感）；
 * - impression 是她自维护的"关于用户的印象"文本块（她的原话，注入 prompt）；
 * - eval_message_count 用于惰性触发：每累计 10 条新用户消息自省一次；
 * - change_date + daily_changes_json 实现单日变化上限（防刷）。
 */
export const relationshipDimensions = sqliteTable(
  'relationship_dimensions',
  {
    agentId: text('agent_id').primaryKey(),
    trust: real('trust').notNull().default(0.2),
    familiarity: real('familiarity').notNull().default(0.1),
    closeness: real('closeness').notNull().default(0.15),
    fun: real('fun').notNull().default(0.2),
    dependency: real('dependency').notNull().default(0.05),
    tension: real('tension').notNull().default(0),
    grudge: real('grudge').notNull().default(0),
    /** 她自维护的"关于用户的印象"（第一人称原话，注入 prompt） */
    impression: text('impression').notNull().default(''),
    /** 最近一次事件分类的说明 */
    reason: text('reason').notNull().default(''),
    /** 上次自省时的用户消息数（触发节流） */
    evalMessageCount: integer('eval_message_count').notNull().default(0),
    /** 单日变化上限的记日期（本地 YYYY-MM-DD） */
    changeDate: text('change_date'),
    /** 当日各维度已变化的绝对值 JSON */
    dailyChangesJson: text('daily_changes_json').notNull().default('{}'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('relationship_trust_range', sql`${t.trust} >= 0 AND ${t.trust} <= 1`),
    check('relationship_familiarity_range', sql`${t.familiarity} >= 0 AND ${t.familiarity} <= 1`),
    check('relationship_closeness_range', sql`${t.closeness} >= 0 AND ${t.closeness} <= 1`),
    check('relationship_fun_range', sql`${t.fun} >= 0 AND ${t.fun} <= 1`),
    check('relationship_dependency_range', sql`${t.dependency} >= 0 AND ${t.dependency} <= 1`),
    check('relationship_tension_range', sql`${t.tension} >= 0 AND ${t.tension} <= 1`),
    check('relationship_grudge_range', sql`${t.grudge} >= 0 AND ${t.grudge} <= 1`),
  ],
);

export type RelationshipDimensions = typeof relationshipDimensions.$inferSelect;