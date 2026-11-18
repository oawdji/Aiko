import { generateText } from 'ai';
import { PersonaPatchSchema, type PersonaPatch } from '@aiko/shared';
import type { LlmConfig } from '../config/llm';
import { getChatModel } from '../llm/provider';
import { resolveEffectiveLlmSettings } from '../settings/service';
import type { DbHandle } from '../db/client';

/** LLM 完成函数抽象：真实实现与测试 fake 都满足此形状（仿 extraction/types.ts CompleteFn）。 */
export type PersonaCompleteFn = (args: {
  system: string;
  prompt: string;
}) => Promise<string>;

export function createDefaultPersonaComplete(handle: DbHandle): PersonaCompleteFn {
  return async ({ system, prompt }) => {
    const settings = resolveEffectiveLlmSettings(handle);
    if (!settings.apiKey) {
      throw new Error('LLM_API_KEY not configured; skip persona propose');
    }
    const config: LlmConfig = {
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
    };
    const { text } = await generateText({
      model: getChatModel(config),
      system,
      prompt,
    });
    return text;
  };
}

/** 容错解析 LLM 输出为 PersonaPatch：去围栏 → 截取 JSON → 兼容 {"patch":...} 或裸对象。 */
export function parsePatchResponse(raw: string): {
  patch: PersonaPatch | null;
  error: string | null;
} {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const inner = fence?.[1];
  if (inner) text = inner.trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { patch: null, error: 'no JSON object found in response' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { patch: null, error: 'invalid JSON in response' };
  }
  const candidate = (parsed as { patch?: unknown }).patch ?? parsed;
  const result = PersonaPatchSchema.safeParse(candidate);
  if (!result.success) {
    return { patch: null, error: `patch schema mismatch: ${result.error.message}` };
  }
  return { patch: result.data, error: null };
}
