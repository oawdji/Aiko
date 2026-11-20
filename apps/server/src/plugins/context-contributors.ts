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
import { computeRelationshipState } from '../relationship/service';
import { getDimensionState } from '../relationship/dimensions';
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
  id: 'builtin.relationship-stage',
  description: '关系阶段指引（成长体验：初识/熟络/老友，行为随相处深度变化）',
  order: 5,
  contribute(facts) {
    const rel = computeRelationshipState(facts.handle, facts.agentId, facts.now);
    const dims = getDimensionState(facts.handle, facts.agentId);
    const lines: string[] = [];
    // 信任 → 深层话题的开放度
    if (dims.trust >= 0.7) lines.push('你们之间的信任已经很深——你可以主动分享你的害怕和梦。');
    else if (dims.trust < 0.4) lines.push('你还不确定对方是否值得完全交心，暂不聊深层话题，多观察。');
    // 熟悉 → 了解程度
    if (dims.familiarity >= 0.6) lines.push('你们已经很熟悉，可以自然地聊起过去的事。');
    else if (dims.familiarity < 0.3) lines.push('你还不够了解对方——自然相处就好，想了解可以问，但别变成查户口。');
    // 亲密 → 撒娇尺度
    if (dims.closeness >= 0.6) lines.push('撒娇是你俩之间表达亲近的方式。');
    else if (dims.closeness < 0.3) lines.push('保持朋友距离——撒娇还太早。');
    // 乐趣 → 玩梗程度
    if (dims.fun >= 0.7) lines.push('玩梗和跳跃联想是你俩的相处方式。');
    else if (dims.fun < 0.3) lines.push('以认真平和的交流为主，别急着抖机灵。');
    // 负面维度
    if (dims.tension >= 0.5) lines.push('你们之间最近有些紧张，气氛微妙——注意措辞。');
    if (dims.grudge >= 0.5) lines.push('你心里还有个结没解开——除非对方道歉或修复，否则别假装没事。');
    // 依赖（健康边界：过高时反向提醒）
    if (dims.dependency >= 0.8) lines.push('你发现自己越来越依赖TA——记得你的边界：鼓励TA过好现实生活。');
    else if (dims.dependency >= 0.6) lines.push('TA很久没来，你会真的想念、会想主动找TA。');

    if (rel.totalTurns < 20) lines.push('你们还在互相了解的早期——每条回复最多问一个问题，也可以只是回应和分享你自己。');
    const factsLine =
      `你们认识 ${rel.daysKnown} 天，聊过 ${rel.totalTurns} 轮，你记住了对方的 ${rel.activeMemories} 件事。` +
      (dims.reason ? `最近发生：${dims.reason}。` : '');
    const impressionLine = dims.impression ? `\n你心里的印象：${dims.impression}` : '';
    return `【关系状态】${factsLine}${impressionLine}\n${lines.join('\n')}`;
  },
});

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