import { z } from 'zod';
import type { CompleteFn } from '../extraction/types';
import { EMOTION_DELTA_LIMIT, extractEmotion, type EmotionExtraction } from './emotion-rules';

/** 引擎标识：emotion-llm-v1（LLM 结构化抽取，失败回退词典规则）。 */
export const EMOTION_LLM_VERSION = 'emotion-llm-v1';

const EmotionLlmOutputSchema = z.object({
  emotion: z.union([
    z.null(),
    z.object({
      delta: z.object({
        valence: z.number(),
        arousal: z.number(),
        dominance: z.number(),
      }),
      confidence: z.number().min(0).max(1),
      evidenceText: z.string().min(1),
      reason: z.string().min(1),
    }),
  ]),
});

const EMOTION_LLM_SYSTEM_PROMPT = [
  '你是情绪分析模块。分析「用户消息」中用户的情绪，输出 PAD 三维（愉悦度 valence / 唤醒度 arousal / 支配度 dominance，取值范围 -1 到 1）的该条消息情绪变化（delta）。',
  '规则：',
  '- 消息没有明显情绪（日常陈述、事实问答、纯指令等）时，输出 {"emotion":null}；',
  '- 有明显情绪时，输出 {"emotion":{"delta":{"valence":number,"arousal":number,"dominance":number},"confidence":number,"evidenceText":"触发情绪的关键词或短语","reason":"一句话中文说明"}}；',
  '- delta 是这条消息带来的情绪变化量，通常在 -0.3 到 0.3 之间，不要夸大；',
  '- 注意语境、反讽与否定（例如「呵呵」「算了」「随便你」往往是负面情绪）；',
  '- confidence 取 0 到 1；',
  '- 只输出一个 JSON 对象，不要输出任何其他文字或代码块标记。',
].join('\n');

/** 从 LLM 回复中提取 JSON（容忍代码块围栏与前后杂文本）。 */
export function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('no JSON object found in LLM output');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function clampDelta(value: number): number {
  return Math.min(EMOTION_DELTA_LIMIT, Math.max(-EMOTION_DELTA_LIMIT, value));
}

/**
 * LLM 结构化情绪抽取引擎（主路径 LLM，失败回退词典）：
 * - complete 未注入（测试/降级）时直接退化为词典规则；
 * - LLM 调用失败或输出不合法 → 回退 extractEmotion，不影响聊天主链路；
 * - LLM 明确判定无明显情绪（emotion: null）→ 返回 null（不产生状态事件）；
 * - delta 超出单条上限时截断（§10.5，与词典引擎一致）。
 */
export function createLlmEmotionEngine(complete?: CompleteFn) {
  if (!complete) {
    return (text: string): EmotionExtraction | null => extractEmotion(text);
  }
  return async (text: string): Promise<EmotionExtraction | null> => {
    try {
      const raw = await complete({
        system: EMOTION_LLM_SYSTEM_PROMPT,
        prompt: `用户消息：\n${text}`,
      });
      const parsed = EmotionLlmOutputSchema.safeParse(extractJsonObject(raw));
      if (!parsed.success) {
        return extractEmotion(text);
      }
      if (parsed.data.emotion === null) {
        return null;
      }
      const { delta, confidence, evidenceText, reason } = parsed.data.emotion;
      return {
        delta: {
          valence: Number(clampDelta(delta.valence).toFixed(4)),
          arousal: Number(clampDelta(delta.arousal).toFixed(4)),
          dominance: Number(clampDelta(delta.dominance).toFixed(4)),
        },
        confidence: Number(confidence.toFixed(2)),
        evidenceText,
        reason,
      };
    } catch (error) {
      console.warn(
        `[emotion] ${EMOTION_LLM_VERSION} failed, fallback to rules:`,
        error instanceof Error ? error.message : error,
      );
      return extractEmotion(text);
    }
  };
}
