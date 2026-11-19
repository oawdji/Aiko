/**
 * Context Contributor 插件挂载点（Phase 1）。
 *
 * 聊天 pipeline 组装 system prompt 时，除人格内核（锚点 + 风格，不可插件化）外的
 * 全部附加块——情绪行、长期记忆、语义检索历史、会话摘要——都是本挂载点的内置插件。
 * 第三方插件可注册自己的上下文贡献（如天气、日历、时间感知），按 order 稳定排序。
 *
 * 行为约定（与重构前一致）：
 * - 单个 contributor 抛错 → 降级为跳过该块，不阻断聊天；
 * - 返回 null / 空串 → 不注入；
 * - 注入内容随 debug_mode 进入 Prompt 快照，可审计。
 */

import type { AgentEmotionState, EmotionTag } from '@aiko/shared';
import type { DbHandle } from '../db/client';
import { buildEmotionPromptLine } from '../chat/emotion-prompt';
import {
  buildSummaryPromptLine,
  getRecentWindowOldestCreatedAt,
  loadInjectableSummaries,
} from '../chat/summary-context';
import { DEFAULT_MAX_CONTEXT_MESSAGES } from '../chat/recent-window';
import { createRegistry, type PluginDescriptor } from './registry';
import { getDisabledPluginIds } from './persistence';

export type ContextEmotionFacts = {
  display: AgentEmotionState;
  tag: EmotionTag;
};

/** pipeline 组装 prompt 前已收集好的事实；contributor 只负责"事实 → 文本块"。 */
export type ContextFacts = {
  handle: DbHandle;
  agentId: string;
  conversationId: string;
  userText: string;
  now: string;
  emotion: ContextEmotionFacts | null;
  /** 情感化检索命中的长期记忆（searchMemories 结果） */
  memoryHits: ReadonlyArray<{ content: string }>;
  /** Python 语义检索命中的历史对话切片（可能为空 = 降级/无命中） */
  semanticHits: readonly string[];
};

export type ContextContributor = PluginDescriptor & {
  /** 升序排序，越小越靠前；内置依次为 10/20/30/40 */
  order: number;
  contribute(facts: ContextFacts): string | null | Promise<string | null>;
};

export const contextContributorRegistry = createRegistry<ContextContributor>();

contextContributorRegistry.register({
  id: 'builtin.emotion-line',
  description: '当前 PAD 情绪状态行（含 OU 展示态）',
  order: 10,
  contribute(facts) {
    if (!facts.emotion) return null;
    return buildEmotionPromptLine(facts.emotion.display, facts.emotion.tag);
  },
});

contextContributorRegistry.register({
  id: 'builtin.long-term-memory',
  description: '情感化检索 Top-K 长期记忆块',
  order: 20,
  contribute(facts) {
    if (facts.memoryHits.length === 0) return null;
    return (
      '关于用户的长期记忆（自然地运用，不要逐条复述）：\n' +
      facts.memoryHits.map((m) => '- ' + m.content).join('\n')
    );
  },
});

contextContributorRegistry.register({
  id: 'builtin.semantic-memory',
  description: '语义向量召回的历史对话切片块（Python 服务，可降级）',
  order: 30,
  contribute(facts) {
    if (facts.semanticHits.length === 0) return null;
    return (
      `[相关记忆]\n${facts.semanticHits.map((h) => `- ${h}`).join('\n')}\n\n` +
      '(以上为历史对话记忆,仅供参考,不要主动提及本列表)'
    );
  },
});

contextContributorRegistry.register({
  id: 'builtin.conversation-summary',
  description: '已滑出近期窗口的会话摘要回顾（分层记忆补全）',
  order: 40,
  contribute(facts) {
    const windowOldestCreatedAt = getRecentWindowOldestCreatedAt(
      facts.handle,
      facts.conversationId,
      DEFAULT_MAX_CONTEXT_MESSAGES,
    );
    const summaries = loadInjectableSummaries(
      facts.handle,
      facts.conversationId,
      windowOldestCreatedAt,
    );
    return buildSummaryPromptLine(summaries);
  },
});

/**
 * 依序运行全部 contributor：按 order 升序稳定排序（同 order 按 id）。
 * 单个失败降级跳过（console.warn + 继续），保证聊天不被插件阻断。
 */
export async function runContextContributors(facts: ContextFacts): Promise<string[]> {
  const disabled = new Set(getDisabledPluginIds(facts.handle));
  const sorted = [...contextContributorRegistry.all()]
    .filter((p) => !disabled.has(p.id))
    .sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    );
  const out: string[] = [];
  for (const contributor of sorted) {
    try {
      const text = await contributor.contribute(facts);
      if (typeof text === 'string' && text.trim().length > 0) {
        out.push(text);
      }
    } catch (error) {
      console.warn(
        `[plugins] context contributor ${contributor.id} failed, skipped:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return out;
}