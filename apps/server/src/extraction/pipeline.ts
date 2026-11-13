import { generateText } from 'ai';
import { resolveEffectiveLlmSettings } from '../settings/service';
import { getChatModel } from '../llm/provider';
import type { LlmConfig } from '../config/llm';
import type { DbHandle } from '../db/client';
import type { CompleteFn } from './types';
import { extractFacts } from './extractor';
import { computeHalfLifeHours } from './gating';
import { createMemory } from '../memories/service';
import type { MemoryOwner } from '../memories/repository';

/**
 * 抽取管线（S3b）：把 extractor 的产物写入 memories 表。
 * - 编码：写入时 PAD 来自当次 state_event 的 after 快照（§4.2），无事件 arousal=0；
 * - 门控：half_life = base × (1 + arousal)（§4.3）；
 * - 幂等：同 source+content 由唯一索引兜底，重复抽取静默跳过；
 * - 失败：完全不影响聊天响应，只记 warning（§4.1）。
 */

export type FactEncodingInput = {
  owner: MemoryOwner;
  sourceMessageId: string;
  userText: string;
  pad: { v: number; a: number; d: number } | null;
  now: string;
};

export function createDefaultExtractComplete(handle: DbHandle): CompleteFn {
  return async ({ system, prompt }) => {
    const settings = resolveEffectiveLlmSettings(handle);
    if (!settings.apiKey) {
      throw new Error('LLM_API_KEY not configured; skip fact extraction');
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

/** 单条消息的抽取 + 入库。返回入库条数；所有可预期失败都已吞掉。 */
export async function extractAndStoreFacts(
  handle: DbHandle,
  input: FactEncodingInput,
  complete: CompleteFn = createDefaultExtractComplete(handle),
): Promise<number> {
  let stored = 0;
  const { facts, error } = await extractFacts(complete, input.userText);
  if (error) {
    console.warn(
      `[extract] skip facts for ${input.sourceMessageId}: ${error}`,
    );
    return 0;
  }

  for (const fact of facts) {
    try {
      createMemory(handle, {
        owner: input.owner,
        type: fact.type,
        content: fact.content,
        sourceMessageId: input.sourceMessageId,
        confidence: fact.confidence,
        memoryPad: input.pad ?? { v: 0, a: 0, d: 0 },
        arousal: input.pad ? Math.max(0, input.pad.a) : 0,
        halfLifeHours: computeHalfLifeHours(
          undefined,
          input.pad ? Math.max(0, input.pad.a) : 0,
        ),
        now: input.now,
      });
      stored += 1;
    } catch (dbError) {
      // 幂等兜底：同 source+content 重复入库（唯一索引）等可预期冲突静默跳过
      const code = (dbError as { code?: string }).code;
      if (code === 'SQLITE_CONSTRAINT_UNIQUE') continue;
      console.warn(
        `[extract] store failed for ${input.sourceMessageId}:`,
        dbError,
      );
    }
  }
  return stored;
}

/**
 * fire-and-forget：聊天管线调用后不 await，抽取失败只记日志。
 * 返回 promise 仅用于测试同步等待。
 */
export function scheduleFactExtraction(
  handle: DbHandle,
  input: FactEncodingInput,
  complete?: CompleteFn,
): Promise<number> {
  return extractAndStoreFacts(handle, input, complete).catch((error) => {
    console.warn('[extract] unexpected pipeline error:', error);
    return 0;
  });
}
