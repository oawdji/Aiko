import { mkdtempSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import {
  assertPersonaCoreIntact,
  deactivateOtherPersonaVersions,
  getActivePersona,
  getActivePersonaVersionRow,
  getProposalRow,
  insertPersonaVersionRow,
  PersonaCoreIntegrityError,
  updateAgentPersonaPointer,
} from '../repository';
import {
  approveProposal,
  listPersonaVersions,
  listProposals,
  proposePersona,
  rejectProposal,
  rollbackToVersion,
  updatePersonaCore,
} from '../service';
import type { PersonaCompleteFn } from '../llm';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const T0 = '2026-11-16T12:00:00.000Z';
let handle: DbHandle;
const tempDirs: string[] = [];

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiko-persona-svc-'));
  tempDirs.push(dir);
  handle = createDb(path.join(dir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, T0);
});

afterAll(() => {
  handle.sqlite.close();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** 每个用例独立状态：清空提案、删除 v3+ 版本、指针回到种子版本（种子行永不修改）。 */
beforeEach(() => {
  handle.sqlite.prepare('DELETE FROM persona_proposals').run();
  handle.sqlite.prepare('DELETE FROM persona_versions WHERE version > 3').run();
  // 恢复种子版本活跃标记（此前用例可能已将其停用）
  handle.sqlite.prepare('UPDATE persona_versions SET is_active = 1 WHERE version = 3').run();
  updateAgentPersonaPointer(handle, DEFAULT_AGENT_ID, 3, T0);
});

function hour(n: number): string {
  return new Date(Date.parse(T0) + n * 3600000).toISOString();
}

function makeComplete(patch: Record<string, unknown>): PersonaCompleteFn {
  return async () => JSON.stringify({ patch });
}

describe('proposePersona', () => {
  it('creates a pending proposal with base version and diff summary', async () => {
    const p = await proposePersona(
      handle,
      { agentId: DEFAULT_AGENT_ID, requestText: '幽默一点', now: T0 },
      makeComplete({ humor: 0.55 }),
    );
    expect(p.status).toBe('pending');
    expect(p.baseVersion).toBe(3);
    expect(p.patch).toEqual({ humor: 0.55 });
    expect(p.diffSummary).toContain('幽默程度：50% → 55%');
    expect(p.source).toBe('user_request');
  });

  it('rejects a second proposal while one is pending', async () => {
    await proposePersona(
      handle,
      { agentId: DEFAULT_AGENT_ID, requestText: 'x', now: T0 },
      makeComplete({ humor: 0.5 }),
    );
    await expect(
      proposePersona(
        handle,
        { agentId: DEFAULT_AGENT_ID, requestText: 'y', now: hour(1) },
        makeComplete({ warmth: 0.7 }),
      ),
    ).rejects.toThrow(/待确认提案/);
  });

  it('enforces cooldown after reject', async () => {
    const p = await proposePersona(
      handle,
      { agentId: DEFAULT_AGENT_ID, requestText: 'x', now: T0 },
      makeComplete({ humor: 0.5 }),
    );
    rejectProposal(handle, DEFAULT_AGENT_ID, p.id, T0);
    await expect(
      proposePersona(
        handle,
        { agentId: DEFAULT_AGENT_ID, requestText: 'y', now: '2026-11-16T12:30:00.000Z' },
        makeComplete({ warmth: 0.7 }),
      ),
    ).rejects.toThrow(/间隔过短/);
    const p2 = await proposePersona(
      handle,
      { agentId: DEFAULT_AGENT_ID, requestText: 'y', now: hour(2) },
      makeComplete({ warmth: 0.7 }),
    );
    expect(p2.status).toBe('pending');
  });

  it('rejects when LLM output is invalid, over-step, or empty', async () => {
    await expect(
      proposePersona(
        handle,
        { agentId: DEFAULT_AGENT_ID, requestText: 'x', now: T0 },
        makeComplete({ warmth: 5 }),
      ),
    ).rejects.toThrow(/提案生成失败/);
    await expect(
      proposePersona(
        handle,
        { agentId: DEFAULT_AGENT_ID, requestText: 'x', now: hour(2) },
        makeComplete({ warmth: 1 }),
      ),
    ).rejects.toThrow(/分多次调整/);
    await expect(
      proposePersona(
        handle,
        { agentId: DEFAULT_AGENT_ID, requestText: 'x', now: hour(4) },
        makeComplete({}),
      ),
    ).rejects.toThrow(/为空/);
  });
});

describe('approveProposal', () => {
  it('creates a new active version and switches pointer', async () => {
    const p = await proposePersona(
      handle,
      { agentId: DEFAULT_AGENT_ID, requestText: '简洁一点', now: T0 },
      makeComplete({ verbosity: 'concise', warmth: 0.5 }),
    );
    const reviewedAt = '2026-11-16T12:01:00.000Z';
    const r = approveProposal(handle, DEFAULT_AGENT_ID, p.id, reviewedAt);
    expect(r.version).toBe(4);
    expect(r.evolvable.verbosity).toBe('concise');
    const active = getActivePersona(handle, DEFAULT_AGENT_ID);
    expect(active!.version).toBe(4);
    expect(active!.evolvable.verbosity).toBe('concise');
    const row = getProposalRow(handle, DEFAULT_AGENT_ID, p.id)!;
    expect(row.status).toBe('approved');
    expect(row.reviewedAt).toBe(reviewedAt);
    // 锚点不变（F21）：新版本复制活跃版本（v3）的 core 与 hash
    const prev = handle.sqlite
      .prepare("SELECT persona_core_md, persona_core_hash FROM persona_versions WHERE version = 3")
      .get() as { persona_core_md: string; persona_core_hash: string };
    const next = handle.sqlite
      .prepare("SELECT persona_core_md, persona_core_hash FROM persona_versions WHERE version = 4")
      .get() as { persona_core_md: string; persona_core_hash: string };
    expect(next.persona_core_md).toBe(prev.persona_core_md);
    expect(next.persona_core_hash).toBe(prev.persona_core_hash);
  });

  it('enforces base_version guard when active moved on', async () => {
    const p = await proposePersona(
      handle,
      { agentId: DEFAULT_AGENT_ID, requestText: 'x', now: T0 },
      makeComplete({ warmth: 0.5 }),
    );
    // 手动推进到 v5，使提案的 base_version=3 落后
    const active = getActivePersonaVersionRow(handle, DEFAULT_AGENT_ID)!;
    // 顺序约束：先停用旧版本，再插入 v5（partial unique index）
    deactivateOtherPersonaVersions(handle, DEFAULT_AGENT_ID, 4);
    insertPersonaVersionRow(handle, {
      id: `persona_${randomUUID()}`,
      agentId: DEFAULT_AGENT_ID,
      version: 5,
      personaCoreMd: active.personaCoreMd,
      personaCoreHash: active.personaCoreHash,
      evolvableJson: JSON.stringify({
        verbosity: 'detailed',
        warmth: 0.6,
        humor: 0.3,
        proactiveQuestions: 0.4,
        notes: [],
      }),
      isActive: 1,
      createdAt: hour(1),
      activatedAt: hour(1),
    });
    updateAgentPersonaPointer(handle, DEFAULT_AGENT_ID, 4, hour(1));
    expect(() =>
      approveProposal(handle, DEFAULT_AGENT_ID, p.id, hour(2)),
    ).toThrow(/stale/);
  });
});

describe('rejectProposal', () => {
  it('rejects a pending proposal and blocks later approve', async () => {
    const p = await proposePersona(
      handle,
      { agentId: DEFAULT_AGENT_ID, requestText: 'x', now: T0 },
      makeComplete({ humor: 0.4 }),
    );
    const r = rejectProposal(handle, DEFAULT_AGENT_ID, p.id, '2026-11-16T12:05:00.000Z');
    expect(r.status).toBe('rejected');
    expect(() =>
      approveProposal(handle, DEFAULT_AGENT_ID, p.id, '2026-11-16T12:06:00.000Z'),
    ).toThrow(/pending/);
  });
});

describe('approve on expired proposal', () => {
  it('marks proposal expired and refuses approval', async () => {
    const p = await proposePersona(
      handle,
      { agentId: DEFAULT_AGENT_ID, requestText: 'x', now: T0 },
      makeComplete({ humor: 0.4 }),
    );
    const late = new Date(Date.parse(T0) + 25 * 3600000).toISOString();
    expect(() => approveProposal(handle, DEFAULT_AGENT_ID, p.id, late)).toThrow(/过期/);
    const row = getProposalRow(handle, DEFAULT_AGENT_ID, p.id)!;
    expect(row.status).toBe('expired');
  });
});

describe('rollbackToVersion (追加式)', () => {
  it('creates a new version copying target content and writes rollback audit', async () => {
    const p = await proposePersona(
      handle,
      { agentId: DEFAULT_AGENT_ID, requestText: '简洁一点', now: T0 },
      makeComplete({ verbosity: 'concise' }),
    );
    approveProposal(handle, DEFAULT_AGENT_ID, p.id, '2026-11-16T12:01:00.000Z');

    const r = rollbackToVersion(handle, DEFAULT_AGENT_ID, 3, hour(2));
    expect(r.version).toBe(5);
    expect(r.evolvable.verbosity).toBe('balanced');
    const active = getActivePersona(handle, DEFAULT_AGENT_ID)!;
    expect(active.version).toBe(5);
    expect(active.evolvable.verbosity).toBe('balanced');

    const audits = listProposals(handle, DEFAULT_AGENT_ID, { status: 'approved' });
    const rollbackAudit = audits.find((a) => a.source === 'rollback');
    expect(rollbackAudit).toBeDefined();
    expect(rollbackAudit!.requestText).toContain('回滚到 v3');
  });

  it('throws when target version is already active', async () => {
    const p = await proposePersona(
      handle,
      { agentId: DEFAULT_AGENT_ID, requestText: 'x', now: T0 },
      makeComplete({ verbosity: 'concise' }),
    );
    approveProposal(handle, DEFAULT_AGENT_ID, p.id, '2026-11-16T12:01:00.000Z');
    expect(() =>
      rollbackToVersion(handle, DEFAULT_AGENT_ID, 4, hour(2)),
    ).toThrow(/已是活跃版本/);
    expect(() =>
      rollbackToVersion(handle, DEFAULT_AGENT_ID, 99, hour(2)),
    ).toThrow(/not found/);
  });
});

describe('queries', () => {
  it('lists proposals and versions in descending order', async () => {
    const p = await proposePersona(
      handle,
      { agentId: DEFAULT_AGENT_ID, requestText: 'x', now: T0 },
      makeComplete({ verbosity: 'concise' }),
    );
    approveProposal(handle, DEFAULT_AGENT_ID, p.id, '2026-11-16T12:01:00.000Z');
    const proposals = listProposals(handle, DEFAULT_AGENT_ID);
    expect(proposals.length).toBeGreaterThan(0);
    const versions = listPersonaVersions(handle, DEFAULT_AGENT_ID);
    expect(versions.length).toBe(2);
    expect(versions[0]!.version).toBe(4);
  });
});

describe('updatePersonaCore (锚点手动编辑)', () => {
  it('creates new version with new core, keeps evolvable, writes audit', () => {
    const before = getActivePersona(handle, DEFAULT_AGENT_ID)!;
    const newCore = '你是 Aiko。（用户手动修改版）\n\n保持温和自然。';
    const r = updatePersonaCore(handle, DEFAULT_AGENT_ID, newCore, hour(10));
    const expectHash = createHash('sha256').update(newCore, 'utf8').digest('hex');
    // beforeEach 已重置到种子版本，手动编辑产生新版本
    expect(r.version).toBe(4);
    expect(r.personaCoreHash).toBe(expectHash);

    const active = getActivePersona(handle, DEFAULT_AGENT_ID)!;
    expect(active.version).toBe(4);
    expect(active.personaCoreMd).toContain('用户手动修改版');
    // evolvable 沿用不变
    expect(active.evolvable).toEqual(before.evolvable);

    const audits = listProposals(handle, DEFAULT_AGENT_ID, { status: 'approved' });
    const audit = audits.find((a) => a.requestText === '手动修改人格锚点');
    expect(audit).toBeDefined();
  });

  it('rejects empty core text', () => {
    expect(() => updatePersonaCore(handle, DEFAULT_AGENT_ID, '   ', hour(11))).toThrow(/不能为空/);
  });

  it('integrity passes after legitimate edit, fails after raw tamper', () => {
    expect(() => assertPersonaCoreIntact(handle, DEFAULT_AGENT_ID)).not.toThrow();
    handle.sqlite
      .prepare('UPDATE persona_versions SET persona_core_md = ' + "'raw tamper'" + ' WHERE is_active = 1')
      .run();
    expect(() => assertPersonaCoreIntact(handle, DEFAULT_AGENT_ID)).toThrow(
      PersonaCoreIntegrityError,
    );
  });
});
