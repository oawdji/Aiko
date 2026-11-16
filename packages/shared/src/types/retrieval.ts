// 语义检索接口层(T1):仅类型定义,零运行时依赖。
// 实现方(memory/retrieval 的 T5)负责注入 embedder / store / chunker,本文件不感知任何具体实现。
// 模型名、存储位置、切片策略等一律不属于本文件的职责。

/** 记忆元数据,写入时由调用方组装,检索时原样返回。 */
export type MemoryMetadata = {
  /** 记忆产生时间,ISO 8601 字符串。 */
  timestamp: string;
  /** 来源标识,如 "chat-turn" / "reflection" / "import"。 */
  source: string;
  /** 可选:对话轮次序号。 */
  turn?: number;
  /** 可选:自由扩展字段,检索过滤(T5)按需使用。 */
  tags?: string[];
};

/** 单条检索命中结果。 */
export type MemoryHit = {
  /** 命中的记忆原文。 */
  text: string;
  /** 相似度分数,语义由实现方定义(实现方需在文档中说明取值范围与排序方向)。 */
  score: number;
  /** 写入时携带的元数据。 */
  metadata: MemoryMetadata;
};

/** 记忆检索的统一入口。上层(prompt 组装、人格演化管道)只依赖本接口。 */
export interface MemoryRetriever {
  /**
   * 写入/更新记忆。实现方负责切片与向量化;
   * texts 与 metadatas 必须等长,按下标一一对应。
   * @throws 参数长度不一致或包含空文本时实现方应抛错,调用方需自行降级(T7 约定)。
   */
  index(texts: string[], metadatas: MemoryMetadata[]): Promise<void>;

  /**
   * 语义检索,返回按相关度降序的 topK 条结果。
   * 实现方必须保证:库为空、模型不可用等失败场景下返回空数组而非抛错(降级约定,见规划文档 T7)。
   */
  search(query: string, topK: number): Promise<MemoryHit[]>;
};
