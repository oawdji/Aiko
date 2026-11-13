import { describe, expect, it } from 'vitest';
import type { MemoryHit, MemoryMetadata, MemoryRetriever } from '../types/retrieval';

// T1 契约测试:验证接口可被实现方消费,且类型形状稳定。
// 不引入任何真实实现(T5 才提供)。

class FakeRetriever implements MemoryRetriever {
  private items: MemoryHit[] = [];

  async index(texts: string[], metadatas: MemoryMetadata[]): Promise<void> {
    if (texts.length !== metadatas.length) {
      throw new Error('texts and metadatas must have the same length');
    }
    texts.forEach((text, i) => {
      this.items.push({ text, score: 1, metadata: metadatas[i]! });
    });
  }

  async search(query: string, topK: number): Promise<MemoryHit[]> {
    return this.items
      .filter((hit) => hit.text.includes(query))
      .slice(0, topK);
  }
}

describe('MemoryRetriever contract (T1)', () => {
  it('indexes with paired metadata and returns hits in order', async () => {
    const retriever = new FakeRetriever();
    await retriever.index(['用户提到养了一只猫', '用户喜欢深夜聊天'], [
      { timestamp: '2026-11-13T00:00:00Z', source: 'chat-turn', turn: 1 },
      { timestamp: '2026-11-13T00:01:00Z', source: 'chat-turn', turn: 2 },
    ]);

    const hits = await retriever.search('猫', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toBe('用户提到养了一只猫');
    expect(hits[0]!.metadata.turn).toBe(1);
    expect(hits[0]!.metadata.source).toBe('chat-turn');
  });

  it('rejects mismatched index inputs', async () => {
    const retriever = new FakeRetriever();
    await expect(
      retriever.index(['a'], []),
    ).rejects.toThrow('texts and metadatas must have the same length');
  });

  it('respects topK', async () => {
    const retriever = new FakeRetriever();
    await retriever.index(['x1', 'x2', 'x3'], [
      { timestamp: 't', source: 's' },
      { timestamp: 't', source: 's' },
      { timestamp: 't', source: 's' },
    ]);
    expect((await retriever.search('x', 2))).toHaveLength(2);
  });
});
