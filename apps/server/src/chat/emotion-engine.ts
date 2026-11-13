import type { CompleteFn } from '../extraction/types';
import { extractEmotion, type EmotionExtraction } from './emotion-rules';
import { createLlmEmotionEngine } from './emotion-llm';

/** 情绪引擎标识：off = 关闭（永不产生状态事件），rules-v1 = 词典规则，llm-v1 = LLM 结构化抽取（失败回退词典）。 */
export type EmotionEngineId = 'off' | 'rules-v1' | 'llm-v1';

/** 文本 → 情绪抽取（null = 本条不产生事件）。llm-v1 引擎为异步，rules-v1 为同步。 */
export type EmotionEngine = (
  text: string,
) => EmotionExtraction | null | Promise<EmotionExtraction | null>;

export function resolveEmotionEngineId(raw: string | undefined): EmotionEngineId {
  if (raw === 'off') return 'off';
  if (raw === 'llm-v1') return 'llm-v1';
  return 'rules-v1';
}

/** 默认引擎 ID：读取 EMOTION_ENGINE 环境变量（off | rules-v1 | llm-v1，缺省 rules-v1）。 */
export function resolveDefaultEmotionEngineId(): EmotionEngineId {
  return resolveEmotionEngineId(process.env.EMOTION_ENGINE);
}

export function createEmotionEngine(id: EmotionEngineId, complete?: CompleteFn): EmotionEngine {
  if (id === 'off') {
    return () => null;
  }
  if (id === 'llm-v1') {
    return createLlmEmotionEngine(complete);
  }
  return (text) => extractEmotion(text);
}

/** 缺省引擎：环境变量未指定 llm-v1 时为纯词典规则（不依赖 LLM 配置）。 */
export const defaultEmotionEngine: EmotionEngine = createEmotionEngine(
  resolveDefaultEmotionEngineId(),
);
