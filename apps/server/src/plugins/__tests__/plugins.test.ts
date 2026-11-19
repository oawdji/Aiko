import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { DuplicatePluginError, createRegistry } from '../registry';
import {
  contextContributorRegistry,
  runContextContributors,
  type ContextContributor,
} from '../context-contributors';
import { proactiveStrategyRegistry } from '../../proactive/strategy';
import { emotionExtractorRegistry, getDefaultEmotionExtractor } from '../emotion-extractors';
import { getDefaultMemoryRetriever, memoryRetrieverRegistry } from '../retriever';
import { getSharedMemoryClient } from '../../chat/memory-client';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-19T00:00:00.000Z';

let handle: DbHandle;

beforeAll(() => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'aiko-plugins-')), 'agent.sqlite');
  handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
});

describe('createRegistry 基础机制', () => {
  it('register/get/all/unregister + 重复 id 抛 DuplicatePluginError', () => {
    const registry = createRegistry<{ id: string; value: number }>();
    registry.register({ id: 'a', value: 1 });
    registry.register({ id: 'b', value: 2 });
    expect(registry.get('a')?.value).toBe(1);
    expect(registry.all().map((p) => p.id)).toEqual(['a', 'b']);
    expect(() => registry.register({ id: 'a', value: 3 })).toThrow(DuplicatePluginError);
    expect(registry.unregister('a')).toBe(true);
    expect(registry.unregister('a')).toBe(false);
    expect(registry.has('a')).toBe(false);
    expect(registry.all().map((p) => p.id)).toEqual(['b']);
  });
});

describe('context contributor 插件挂载点', () => {
  it('注册了 4 个内置插件，order 为 10/20/30/40', () => {
    const builtins = contextContributorRegistry.all().filter((p) => p.id.startsWith('builtin.'));
    expect(builtins.map((p) => p.id)).toEqual([
      'builtin.emotion-line',
      'builtin.long-term-memory',
      'builtin.semantic-memory',
      'builtin.conversation-summary',
    ]);
    expect(builtins.map((p) => p.order)).toEqual([10, 20, 30, 40]);
  });

  it('按 order 稳定排序运行；无内容块被过滤', async () => {
    const custom: ContextContributor = {
      id: 'test.custom-first',
      order: 5,
      contribute: () => '（自定义上下文块）',
    };
    contextContributorRegistry.register(custom);
    try {
      const out = await runContextContributors({
        handle,
        agentId: DEFAULT_AGENT_ID,
        conversationId: 'conv_none',
        userText: '你好',
        now: NOW,
        emotion: {
          display: { valence: 0.2, arousal: 0.3, dominance: 0.5 },
          tag: 'calm',
        },
        memoryHits: [{ content: '用户在学做饭' }],
        semanticHits: ['历史切片'],
      });
      // 自定义(order 5) → 情绪(10) → 长期记忆(20) → 语义(30)；摘要(40) 无数据为 null 被过滤
      expect(out).toHaveLength(4);
      expect(out[0]).toBe('（自定义上下文块）');
      expect(out[1]).toContain('【当前情绪状态】');
      expect(out[2]).toContain('关于用户的长期记忆');
      expect(out[3]).toContain('[相关记忆]');
    } finally {
      contextContributorRegistry.unregister('test.custom-first');
    }
  });

  it('抛错的 contributor 降级跳过，不阻断其余块', async () => {
    const throwing: ContextContributor = {
      id: 'test.throwing',
      order: 1,
      contribute: () => {
        throw new Error('boom');
      },
    };
    contextContributorRegistry.register(throwing);
    try {
      const out = await runContextContributors({
        handle,
        agentId: DEFAULT_AGENT_ID,
        conversationId: 'conv_none',
        userText: '你好',
        now: NOW,
        emotion: {
          display: { valence: 0, arousal: 0, dominance: 0 },
          tag: 'neutral',
        },
        memoryHits: [],
        semanticHits: [],
      });
      expect(out.some((t) => t.includes('【当前情绪状态】'))).toBe(true);
      expect(out.some((t) => t.includes('boom'))).toBe(false);
    } finally {
      contextContributorRegistry.unregister('test.throwing');
    }
  });

  it('emotion facts 为 null 时情绪行不注入', async () => {
    const out = await runContextContributors({
      handle,
      agentId: DEFAULT_AGENT_ID,
      conversationId: 'conv_none',
      userText: '你好',
      now: NOW,
      emotion: null,
      memoryHits: [],
      semanticHits: [],
    });
    expect(out.some((t) => t.includes('【当前情绪状态】'))).toBe(false);
  });
});

describe('proactive strategy 插件挂载点', () => {
  it('注册了 3 个内置策略，priority 1/2/3', () => {
    const builtins = proactiveStrategyRegistry.all().filter((p) => !p.id.startsWith('test.'));
    expect(builtins.map((p) => p.id)).toEqual(['emotion_care', 'memory_recall', 'curious_question']);
    expect(builtins.map((p) => p.priority)).toEqual([1, 2, 3]);
  });

  it('自定义插件 priority 更小则排序最优先', () => {
    const custom = {
      id: 'test.always',
      description: '测试用最高优先级策略',
      priority: 0,
      pick: () => ({
        strategy: 'curious_question' as const,
        evidence: '测试',
        hint: '测试',
      }),
    };
    proactiveStrategyRegistry.register(custom);
    try {
      const sorted = [...proactiveStrategyRegistry.all()].sort(
        (a, b) => a.priority - b.priority,
      );
      expect(sorted[0]?.id).toBe('test.always');
      // custom 不触碰 handle，可用最小 ctx 验证
      expect(sorted[0]?.pick({} as never)?.evidence).toBe('测试');
    } finally {
      proactiveStrategyRegistry.unregister('test.always');
    }
  });
});

describe('emotion extractor 插件挂载点', () => {
  it('内置 emotion-llm-v2 已注册，默认抽取器可用', () => {
    expect(emotionExtractorRegistry.get('builtin.emotion-llm-v2')).toBeDefined();
    const fn = getDefaultEmotionExtractor(handle);
    expect(typeof fn).toBe('function');
  });
});

describe('memory retriever 插件挂载点', () => {
  it('内置 semantic-python 与 noop 已注册', () => {
    expect(memoryRetrieverRegistry.ids()).toContain('builtin.semantic-python');
    expect(memoryRetrieverRegistry.ids()).toContain('builtin.noop');
  });

  it('默认检索器为 semantic-python，client 为共享单例', () => {
    const def = getDefaultMemoryRetriever();
    expect(def.id).toBe('builtin.semantic-python');
    expect(def.client()).toBe(getSharedMemoryClient());
  });
});