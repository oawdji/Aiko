import { extractEmotion, type EmotionExtraction } from './emotion-rules';

/** 情绪引擎标识：off = 关闭（永不产生状态事件），rules-v1 = 词典规则引擎。 */
export type EmotionEngineId = 'off' | 'rules-v1';

/** 与 LLM 工厂同模式：文本 → 情绪抽取（null = 本条不产生事件）。 */
export type EmotionEngine = (text: string) => EmotionExtraction | null;

export function resolveEmotionEngineId(raw: string | undefined): EmotionEngineId {
  return raw === 'off' ? 'off' : 'rules-v1';
}

export function createEmotionEngine(id: EmotionEngineId): EmotionEngine {
  if (id === 'off') {
    return () => null;
  }
  return (text) => extractEmotion(text);
}

/** 默认引擎：读取 EMOTION_ENGINE 环境变量（off | rules-v1，缺省 rules-v1）。 */
export const defaultEmotionEngine: EmotionEngine = createEmotionEngine(
  resolveEmotionEngineId(process.env.EMOTION_ENGINE),
);