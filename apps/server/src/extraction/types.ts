import { z } from 'zod';
import { MemoryTypeSchema } from '@aiko/shared';

/**
 * 抽取器内部类型（S3a）：LLM 输出的原子事实候选。
 * 注意：这是抽取器契约，不是 memories 表契约；入库仍走 memories/service.createMemory。
 */
export const ExtractedFactSchema = z.object({
  type: MemoryTypeSchema,
  content: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
});
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

/** 可注入的 LLM 完成函数：测试用 fake，生产用 ai SDK generateText 包装。 */
export type CompleteFn = (opts: { system: string; prompt: string }) => Promise<string>;

/** 抽取失败不抛出（memory-emotion-design.md §4.1），只返回空数组。 */
export type ExtractionResult = {
  facts: ExtractedFact[];
  error: string | null;
};
