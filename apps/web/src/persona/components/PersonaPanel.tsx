import { useCallback, useEffect, useState } from 'react';
import type { PersonaProposalDTO, PersonaVersionDTO } from '@aiko/shared';
import {
  approvePersonaProposal,
  fetchPersonaProposals,
  fetchPersonaVersions,
  proposePersona,
  rejectPersonaProposal,
  rollbackPersonaVersion,
} from '../api/persona-api';
import { StyleCard } from './StyleCard';
import { ProposeForm } from './ProposeForm';
import { ProposalCard } from './ProposalCard';
import { VersionHistory } from './VersionHistory';

/**
 * 人格面板抽屉（仿 MemoryViewer 模式）：
 * - 当前风格 / 生成提案 / 待审提案 / 版本回滚；
 * - 组件只通过 persona-api 访问接口，不直接 fetch。
 */
export function PersonaPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [versions, setVersions] = useState<PersonaVersionDTO[]>([]);
  const [proposals, setProposals] = useState<PersonaProposalDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [vs, ps] = await Promise.all([fetchPersonaVersions(), fetchPersonaProposals()]);
      setVersions(vs);
      setProposals(ps);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const active = versions.find((v) => v.isActive) ?? versions[0] ?? null;
  const pending = proposals.filter((p) => p.status === 'pending');

  const reload = useCallback(() => {
    return load().catch(() => undefined);
  }, [load]);

  const handlePropose = useCallback(
    async (requestText: string) => {
      setError(null);
      try {
        const p = await proposePersona(requestText);
        setNotice('提案已生成，确认后生效');
        await reload();
        if (p.status !== 'pending') setNotice(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : '提案生成失败');
      }
    },
    [reload],
  );

  const handleApprove = useCallback(
    (id: string) => {
      setError(null);
      approvePersonaProposal(id)
        .then((r) => {
          setNotice('已生效（v' + r.version + '）');
          return reload();
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : '生效失败'));
    },
    [reload],
  );

  const handleReject = useCallback(
    (id: string) => {
      setError(null);
      rejectPersonaProposal(id)
        .then(() => reload())
        .catch((e: unknown) => setError(e instanceof Error ? e.message : '拒绝失败'));
    },
    [reload],
  );

  const handleRollback = useCallback(
    (version: number) => {
      setError(null);
      rollbackPersonaVersion(version)
        .then((r) => {
          setNotice('已回滚（当前 v' + r.version + '）');
          return reload();
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : '回滚失败'));
    },
    [reload],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      role="dialog"
      aria-label="人格面板"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="flex h-full w-full max-w-lg flex-col gap-3 overflow-y-auto border-l border-neutral-800 bg-neutral-900 p-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold">人格面板</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭人格面板"
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            ✕
          </button>
        </header>

        {error && (
          <p role="alert" className="rounded border border-red-900 bg-red-950 px-2 py-1 text-xs text-red-300">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded border border-emerald-900 bg-emerald-950 px-2 py-1 text-xs text-emerald-300">
            {notice}
          </p>
        )}

        {loading && versions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">加载中…</div>
        ) : (
          <>
            {active && <StyleCard evolvable={active.evolvable} version={active.version} />}
            <ProposeForm disabled={loading} onSubmit={handlePropose} />
            {pending.length > 0 && (
              <section aria-label="待审提案" className="rounded-lg border border-neutral-800 bg-neutral-800/50 p-3">
                <h3 className="mb-2 text-xs font-semibold text-neutral-400">
                  待审提案（{pending.length}）
                </h3>
                <ul className="space-y-2">
                  {pending.map((p) => (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      disabled={loading}
                      onApprove={handleApprove}
                      onReject={handleReject}
                    />
                  ))}
                </ul>
              </section>
            )}
            <VersionHistory versions={versions} disabled={loading} onRollback={handleRollback} />
          </>
        )}

        <p className="text-[10px] text-neutral-600">
          人格锚点不可修改；所有调整都经提案确认后版本化生效，可随时回滚。
        </p>
      </aside>
    </div>
  );
}
