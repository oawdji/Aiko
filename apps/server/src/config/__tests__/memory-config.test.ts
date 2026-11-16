import { describe, expect, it } from 'vitest';
import { loadMemoryConfig } from '../memory';

describe('loadMemoryConfig', () => {
  it('applies defaults when env is empty', () => {
    const cfg = loadMemoryConfig({});
    expect(cfg.embeddingModelName).toBe('BAAI/bge-base-zh-v1.5');
    expect(cfg.embeddingDevice).toBe('cpu');
    expect(cfg.dbPath).toBe('data/memory-vectors.db');
    expect(cfg.chunkMaxChars).toBe(500);
    expect(cfg.chunkOverlapSentences).toBe(1);
    expect(cfg.topK).toBe(5);
  });

  it('accepts valid overrides', () => {
    const cfg = loadMemoryConfig({
      EMBEDDING_MODEL_NAME: 'BAAI/bge-m3',
      EMBEDDING_DEVICE: 'cuda',
      MEMORY_DB_PATH: 'data/test.db',
      MEMORY_CHUNK_MAX_CHARS: '300',
      MEMORY_TOP_K: '3',
    });
    expect(cfg.embeddingModelName).toBe('BAAI/bge-m3');
    expect(cfg.embeddingDevice).toBe('cuda');
    expect(cfg.chunkMaxChars).toBe(300);
    expect(cfg.topK).toBe(3);
  });

  it('rejects invalid values', () => {
    expect(() => loadMemoryConfig({ EMBEDDING_DEVICE: 'tpu' })).toThrow();
    expect(() => loadMemoryConfig({ MEMORY_TOP_K: '0' })).toThrow();
    expect(() => loadMemoryConfig({ MEMORY_CHUNK_MAX_CHARS: '-1' })).toThrow();
  });
});

