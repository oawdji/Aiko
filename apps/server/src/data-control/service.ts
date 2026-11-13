import { eq, ne } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import {
  agents,
  appSettings,
  conversationSummaries,
  conversations,
  memories,
  messages,
  personaVersions,
  promptSnapshots,
  stateEvents,
} from '../db/schema';

/**
 * 数据控制（F32/F33，memory-emotion-design.md §7.3）：
 * - 导出：全量 JSON；已删除记忆只保留操作审计（id/status/时间），不含内容（F18）；
 * - 删除：单事务清空用户数据并重置 Agent 状态快照，返回任务状态与派生数据处理说明。
 */

export function exportAllData(handle: DbHandle): Record<string, unknown> {
  const activeMemories = handle.db
    .select()
    .from(memories)
    .where(ne(memories.status, 'deleted'))
    .all();
  const deletedAudit = handle.db
    .select({ id: memories.id, status: memories.status, updatedAt: memories.updatedAt })
    .from(memories)
    .where(eq(memories.status, 'deleted'))
    .all();

  return {
    exportedAt: new Date().toISOString(),
    format: 'aiko-export-v1',
    agents: handle.db.select().from(agents).all(),
    personaVersions: handle.db.select().from(personaVersions).all(),
    appSettings: handle.db.select().from(appSettings).all(),
    conversations: handle.db.select().from(conversations).all(),
    messages: handle.db.select().from(messages).all(),
    stateEvents: handle.db.select().from(stateEvents).all(),
    conversationSummaries: handle.db.select().from(conversationSummaries).all(),
    promptSnapshots: handle.db.select().from(promptSnapshots).all(),
    memories: activeMemories,
    deletedMemoriesAudit: deletedAudit,
  };
}

export type DeleteDataResult = {
  ok: true;
  deletedAt: string;
  counts: {
    messages: number;
    conversations: number;
    stateEvents: number;
    memories: number;
    summaries: number;
    promptSnapshots: number;
  };
  derivedDataPolicy: string[];
};

/** 清空用户数据（单事务）；保留 agents 人格锚点与 app_settings 配置。 */
export function deleteAllData(handle: DbHandle): DeleteDataResult {
  const count = (n: unknown) => (n as { n: number }).n;
  const countsBefore = {
    messages: count(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM messages').get()),
    conversations: count(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM conversations').get()),
    stateEvents: count(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM state_events').get()),
    memories: count(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM memories').get()),
    summaries: count(
      handle.sqlite.prepare('SELECT COUNT(*) AS n FROM conversation_summaries').get(),
    ),
    promptSnapshots: count(
      handle.sqlite.prepare('SELECT COUNT(*) AS n FROM prompt_snapshots').get(),
    ),
  };

  handle.sqlite.transaction(() => {
    // 外键依赖顺序：子表先行；memories_fts 可能不存在（未启用检索），容错处理
    for (const table of ['prompt_snapshots', 'conversation_summaries', 'memories_fts', 'memories', 'state_events', 'messages', 'conversations']) {
      try {
        handle.sqlite.exec(`DELETE FROM ${table};`);
      } catch {
        // memories_fts 未创建时跳过
      }
    }
    // 派生状态：Agent 快照回归初始基线
    handle.sqlite
      .prepare(
        "UPDATE agents SET current_valence = baseline_valence, current_arousal = baseline_arousal, current_dominance = baseline_dominance, current_tag = 'neutral', state_updated_at = ?",
      )
      .run(new Date().toISOString());
  })();

  return {
    ok: true,
    deletedAt: new Date().toISOString(),
    counts: countsBefore,
    derivedDataPolicy: [
      '情绪状态已重置为角色基线',
      '长期记忆与全文索引已清空',
      '会话摘要已清空',
      'Prompt 快照已清空',
      '人格锚点与版本历史已保留',
    ],
  };
}
