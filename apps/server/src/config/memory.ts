import { z } from 'zod';

// 语义检索(T6)配置。Python 推理模块(services/)通过环境变量读取
// EMBEDDING_* 与 MEMORY_DB_PATH;本模块是 TS 侧的同一份事实来源,
// 供 T7 的调用点与后续 HTTP 客户端使用。
const MemoryEnvSchema = z.object({
  // embedding 模型(T2 的配置默认值与此保持一致)
  EMBEDDING_MODEL_NAME: z.string().trim().min(1).default('BAAI/bge-base-zh-v1.5'),
  EMBEDDING_DEVICE: z.enum(['cpu', 'cuda']).default('cpu'),
  // 向量库文件(T3 默认值的镜像)
  MEMORY_DB_PATH: z.string().trim().min(1).default('data/memory-vectors.db'),
  // 切片参数(T4 默认值的镜像)
  MEMORY_CHUNK_MAX_CHARS: z.coerce.number().int().positive().default(500),
  MEMORY_CHUNK_OVERLAP_SENTENCES: z.coerce.number().int().nonnegative().default(1),
  // 检索注入条数(T7 使用)
  MEMORY_TOP_K: z.coerce.number().int().positive().default(5),
});

export type MemoryConfig = {
  embeddingModelName: string;
  embeddingDevice: 'cpu' | 'cuda';
  dbPath: string;
  chunkMaxChars: number;
  chunkOverlapSentences: number;
  topK: number;
};

/** 全部有默认值,缺失环境变量不会失败;只有非法值才抛错。 */
export function loadMemoryConfig(env: NodeJS.ProcessEnv = process.env): MemoryConfig {
  const result = MemoryEnvSchema.safeParse({
    EMBEDDING_MODEL_NAME: env.EMBEDDING_MODEL_NAME,
    EMBEDDING_DEVICE: env.EMBEDDING_DEVICE,
    MEMORY_DB_PATH: env.MEMORY_DB_PATH,
    MEMORY_CHUNK_MAX_CHARS: env.MEMORY_CHUNK_MAX_CHARS,
    MEMORY_CHUNK_OVERLAP_SENTENCES: env.MEMORY_CHUNK_OVERLAP_SENTENCES,
    MEMORY_TOP_K: env.MEMORY_TOP_K,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid memory retrieval config (${issues}).`);
  }

  return {
    embeddingModelName: result.data.EMBEDDING_MODEL_NAME,
    embeddingDevice: result.data.EMBEDDING_DEVICE,
    dbPath: result.data.MEMORY_DB_PATH,
    chunkMaxChars: result.data.MEMORY_CHUNK_MAX_CHARS,
    chunkOverlapSentences: result.data.MEMORY_CHUNK_OVERLAP_SENTENCES,
    topK: result.data.MEMORY_TOP_K,
  };
}
