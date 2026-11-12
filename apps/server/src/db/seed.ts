import { and, eq } from 'drizzle-orm';
import {
  INITIAL_EVOLVABLE_JSON,
  PERSONA_CORE_HASH,
  PERSONA_CORE_MD,
} from './generated/persona-core';
import { agents, appSettings, personaVersions } from './schema';
import type { DbHandle } from './client';

export const DEFAULT_AGENT_ID = 'agent-default';
export const DEFAULT_AGENT_SLUG = 'default';
export const DEFAULT_PERSONA_ID = 'persona-default-v1';
export const DEFAULT_PERSONA_VERSION = 1;

const DEFAULT_SETTINGS: Array<[key: string, valueJson: string]> = [
  ['default_agent_id', JSON.stringify(DEFAULT_AGENT_ID)],
  ['recent_window_rounds', JSON.stringify(15)],
  ['max_context_messages', JSON.stringify(30)],
  ['theme', JSON.stringify('system')],
];

/**
 * 默认数据初始化（幂等，单事务）：
 * - 默认 Agent（valence 0 / arousal 0 / neutral）；
 * - persona version 1（锚点来自 docs/persona-core-v1.md 生成的模块）；
 * - 四条本地设置（只补缺失键，不覆盖用户已修改的值）。
 * 对应 database-schema.md §6 初始数据与 §13.2 初始化测试。
 */
export function seedDefaultData(handle: DbHandle, now: string): void {
  const { db } = handle;

  handle.sqlite.transaction(() => {
    let agent = db
      .select()
      .from(agents)
      .where(eq(agents.slug, DEFAULT_AGENT_SLUG))
      .get();

    if (!agent) {
      db.insert(agents)
        .values({
          id: DEFAULT_AGENT_ID,
          slug: DEFAULT_AGENT_SLUG,
          displayName: 'Aiko',
          description: null,
          currentValence: 0,
          currentArousal: 0,
          currentTag: 'neutral',
          stateUpdatedAt: null,
          activePersonaVersion: DEFAULT_PERSONA_VERSION,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      agent = db
        .select()
        .from(agents)
        .where(eq(agents.slug, DEFAULT_AGENT_SLUG))
        .get();
    }

    if (agent) {
      const existingPersona = db
        .select()
        .from(personaVersions)
        .where(
          and(
            eq(personaVersions.agentId, agent.id),
            eq(personaVersions.version, DEFAULT_PERSONA_VERSION),
          ),
        )
        .get();

      if (!existingPersona) {
        db.insert(personaVersions)
          .values({
            id: DEFAULT_PERSONA_ID,
            agentId: agent.id,
            version: DEFAULT_PERSONA_VERSION,
            personaCoreMd: PERSONA_CORE_MD,
            personaCoreHash: PERSONA_CORE_HASH,
            evolvableJson: INITIAL_EVOLVABLE_JSON,
            isActive: 1,
            createdAt: now,
            activatedAt: now,
          })
          .run();
      }
    }

    for (const [key, valueJson] of DEFAULT_SETTINGS) {
      const existing = db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .get();

      if (!existing) {
        db.insert(appSettings)
          .values({ key, valueJson, updatedAt: now })
          .run();
      }
    }
  })();
}