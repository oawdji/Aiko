import { ExtractedFactSchema, type CompleteFn, type ExtractionResult } from './types';

/**
 * 事实抽取器（F15，memory-emotion-design.md §4.1）。
 * - structured output 通过 prompt 约束 + zod 容错解析实现，不依赖 provider 特定 JSON mode；
 * - 任何失败（网络/超时/非法 JSON/字段缺失）都返回 { facts: [], error }，绝不抛出，
 *   调用方（chat pipeline）据此决定是否静默跳过。
 */
export const EXTRACT_SYSTEM_PROMPT = [
  '你是一个对话事实抽取器。从用户消息中抽取「关于用户的原子事实」。',
  '规则：',
  '1. 只抽取可长期成立的事实/偏好/目标/关系/事件，不要抽取闲聊、问候、对 Agent 说的话；',
  '2. 每条事实一句话，主语统一为「用户」，中立陈述，不加推测；',
  '3. type 取值：fact(事实) / preference(偏好) / goal(目标) / episode(事件) / relationship(关系)；',
  '4. confidence ∈ [0,1]：明确直述 0.9+，明显但间接 0.7-0.9，猜测性 0.4 以下，宁低勿高；',
  '5. 没有可抽取的事实时返回空数组。',
  '只输出 JSON，格式：{"facts":[{"type":"fact","content":"用户正在学做饭","confidence":0.95}]}',
].join('\n');

const MAX_FACTS_PER_MESSAGE = 5;

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, n));
}

/** 从 LLM 原始输出中容错解析事实数组（去掉 markdown 围栏、截取首个 JSON 对象）。 */
export function parseFactsResponse(raw: string): ExtractionResult {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const inner = fence?.[1];
  if (inner) text = inner.trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { facts: [], error: 'no JSON object found in response' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { facts: [], error: 'invalid JSON in response' };
  }

  const rawFacts = (parsed as { facts?: unknown }).facts;
  if (!Array.isArray(rawFacts)) {
    return { facts: [], error: 'missing facts array' };
  }

  const facts = rawFacts
    .slice(0, MAX_FACTS_PER_MESSAGE)
    .map((item) =>
      ExtractedFactSchema.safeParse({
        ...(typeof item === 'object' && item !== null ? item : {}),
        confidence: clampConfidence(
          (typeof item === 'object' && item !== null
            ? (item as { confidence?: unknown }).confidence
            : 0),
        ),
      }),
    )
    .filter((r) => r.success)
    .map((r) => r.data);

  return { facts, error: null };
}

export async function extractFacts(
  complete: CompleteFn,
  userText: string,
): Promise<ExtractionResult> {
  if (!userText.trim()) return { facts: [], error: null };
  try {
    const raw = await complete({
      system: EXTRACT_SYSTEM_PROMPT,
      prompt: userText,
    });
    return parseFactsResponse(raw);
  } catch (error) {
    return {
      facts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
