import { and, asc, desc, eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { conversationSummaries, messages } from '../db/schema';

/**
 * 会话摘要注入 Prompt（分层记忆补全，修复"只写不读"）：
 * 摘要每 30 条消息生成一份，近期窗口也是 30 条——若不过滤，
 * 最新一份摘要会与当前窗口内容完全重复。因此只注入
 * end 消息早于窗口最旧消息的摘要（即已完全滑出窗口的部分），
 * 窗口内内容模型直接看原文，滑出窗口的部分由摘要兜底，永不丢失。
 */

/**
 * 读取可注入 Prompt 的会话摘要：
 * - 只取 status = 'ready'（pending/failed/deleted 忽略）；
 * - 只取 end 消息 createdAt 早于窗口最旧消息 createdAt 的摘要
 *   （与 lifecycle 摘要范围生成同样基于 createdAt 比较，毫秒相同按跳过处理）；
 * - 按摘要生成时间正序返回。
 * windowOldestCreatedAt 为 null（空会话/无窗口）时注入全部 ready 摘要。
 */
export function loadInjectableSummaries(
  handle: DbHandle,
  conversationId: string,
  windowOldestCreatedAt: string | null,
): string[] {
  const rows = handle.db
    .select({
      content: conversationSummaries.content,
      endCreatedAt: messages.createdAt,
      summaryCreatedAt: conversationSummaries.createdAt,
    })
    .from(conversationSummaries)
    .innerJoin(messages, eq(messages.id, conversationSummaries.endMessageId))
    .where(
      and(
        eq(conversationSummaries.conversationId, conversationId),
        eq(conversationSummaries.status, 'ready'),
      ),
    )
    .orderBy(asc(conversationSummaries.createdAt))
    .all();
  return rows
    .filter(
      (row) => windowOldestCreatedAt === null || row.endCreatedAt < windowOldestCreatedAt,
    )
    .map((row) => row.content);
}

/** 近期窗口最旧消息的 createdAt（与 loadRecentWindow 相同的排序口径；空窗口返回 null）。 */
export function getRecentWindowOldestCreatedAt(
  handle: DbHandle,
  conversationId: string,
  limit: number,
): string | null {
  const rows = handle.db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.status, 'complete')))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit)
    .all();
  return rows.length > 0 ? rows[rows.length - 1]!.createdAt : null;
}

/** 组装 system prompt 摘要块；无摘要返回 null（不注入空块）。 */
export function buildSummaryPromptLine(summaries: string[]): string | null {
  if (summaries.length === 0) return null;
  const items = summaries
    .map((s) => '- ' + s.replace(/\s*\n+\s*/g, ' ').trim())
    .join('\n');
  return (
    '[早期对话回顾]\n' +
    items +
    '\n(以上是更早对话的阶段性摘要，供延续语境使用，不要主动提及本列表)'
  );
}