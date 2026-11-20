import { useEffect, useState } from 'react';
import { agentStateStore, useAgentStateStore } from '../../shared/stores/agent-state-store';
import { fetchRelationship, resetAgentState } from '../../shared/api/state-api';
import type { RelationshipState } from '@aiko/shared';
import { EmotionBars } from './EmotionBars';

/**
 * 状态面板：只订阅 AgentStateStore（react-architecture.md §12.1），
 * 不接收消息流；支持手动重置回气质基线（写入 manual 事件，可追溯）。
 */
export function StatusPanel({
  agentId,
  conversationId,
}: {
  agentId: string;
  conversationId: string;
}) {
  const latestEvent = useAgentStateStore((s) => s.latestEvent);
  const receivedCount = useAgentStateStore((s) => s.receivedCount);
  const state = useAgentStateStore((s) => s.state);
  const discreteTag = useAgentStateStore((s) => s.discreteTag);
  const [resetArmed, setResetArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [relationship, setRelationship] = useState<RelationshipState | null>(null);

  useEffect(() => {
    fetchRelationship(agentId)
      .then((r) => setRelationship(r))
      .catch(() => setRelationship(null));
  }, [agentId]);

  const handleReset = () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    setResetting(true);
    setResetError(null);
    resetAgentState(agentId, conversationId)
      .then((res) => {
        agentStateStore.applyStateEvent(res.event);
      })
      .catch((e) => {
        setResetError(e instanceof Error ? e.message : '重置失败');
      })
      .finally(() => setResetting(false));
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-3 text-sm font-semibold">Agent 状态</h2>
      <div className="space-y-3 text-xs text-neutral-300">
        {relationship && (
          <p className="text-neutral-400">
            关系：{relationship.stageLabel} · 认识第 {relationship.daysKnown + 1} 天 ·{' '}
            {relationship.totalTurns} 轮对话
          </p>
        )}
        <EmotionBars state={state} />
        <p>
          tag：<span className="text-emerald-400">{discreteTag}</span>
        </p>
        {latestEvent ? (
          <>
            <p className="text-neutral-400">原因：{latestEvent.reason}</p>
            <p className="text-neutral-500">
              事件计数（含 bootstrap 恢复）：{receivedCount}
            </p>
          </>
        ) : (
          <p className="text-neutral-500">尚未收到状态事件。</p>
        )}
        <div className="flex items-center gap-2 border-t border-neutral-800 pt-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            aria-label={resetArmed ? '确认重置回基线' : '重置情绪回基线'}
            className={
              resetArmed
                ? 'rounded border border-amber-600 bg-amber-950 px-2 py-1 text-amber-300 hover:bg-amber-900 disabled:opacity-50'
                : 'rounded border border-neutral-700 px-2 py-1 text-neutral-400 hover:bg-neutral-800 disabled:opacity-50'
            }
          >
            {resetting ? '重置中…' : resetArmed ? '确认重置？' : '↺ 重置回基线'}
          </button>
          <span className="text-[10px] text-neutral-600">写入 manual 事件，可追溯</span>
        </div>
        {resetError && (
          <p role="alert" className="text-[10px] text-red-400">{resetError}</p>
        )}
      </div>
    </div>
  );
}