/**
 * Emotion Extractor 插件挂载点（Phase 1）。
 *
 * 情绪抽取决定每轮对话的 PAD 增量方向。内置实现为 emotion-llm-v2
 * （小 LLM 独立抽取，见 chat/emotion-extract.ts）。
 * 抽取失败返回 null / 抛错均由 pipeline 降级（不产生状态事件、不阻断聊天）。
 */

import type { DbHandle } from '../db/client';
import type { PromptMessage } from '../chat/recent-window';
import { extractEmotionViaLlm } from '../chat/emotion-extract';
import { createRegistry, type PluginDescriptor } from './registry';
import { getDisabledPluginIds } from './persistence';

export type EmotionExtractionResult = {
  tag: string;
  intensity: number;
  reason: string;
} | null;

export type EmotionExtractorFn = (
  userMessage: string,
  recent: PromptMessage[],
) => Promise<EmotionExtractionResult>;

export type EmotionExtractorPlugin = PluginDescriptor & {
  /** pipeline 每次聊天调用 create 得到绑定 handle 的抽取函数 */
  create(handle: DbHandle): EmotionExtractorFn;
};

export const emotionExtractorRegistry = createRegistry<EmotionExtractorPlugin>();

emotionExtractorRegistry.register({
  id: 'builtin.emotion-llm-v2',
  description: '小 LLM 独立抽取（max_tokens≈50），6 分区离散标签，失败降级为无事件',
  create(handle) {
    return (userMessage, recent) => extractEmotionViaLlm(handle, userMessage, recent);
  },
});

/** 默认抽取器 = 注册表第一个插件（内置注册顺序即优先级）。 */
export function getDefaultEmotionExtractor(handle: DbHandle): EmotionExtractorFn {
  const disabled = new Set(getDisabledPluginIds(handle));
  const first = emotionExtractorRegistry.all().find((p) => !disabled.has(p.id));
  if (!first) {
    throw new Error('no emotion extractor plugin registered');
  }
  return first.create(handle);
}