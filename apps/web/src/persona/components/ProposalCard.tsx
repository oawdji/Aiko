import { useState } from 'react';
import type { PersonaProposalDTO } from '@aiko/shared';
import { StyleDiff } from './StyleDiff';

type Props = {
  proposal: PersonaProposalDTO;
  disabled: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
};

/** 待审提案卡片：diff 展示 + 两步确认的批准 / 拒绝。 */
export function ProposalCard({ proposal, disabled, onApprove, onReject }: Props) {
  const [armed, setArmed] = useState<'approve' | 'reject' | null>(null);

  const act = (action: 'approve' | 'reject') => {
    if (armed !== action) {
      setArmed(action);
      return;
    }
    setArmed(null);
    if (action === 'approve') onApprove(proposal.id);
    else onReject(proposal.id);
  };

  return (
    <li className="rounded border border-amber-900/60 bg-amber-950/20 p-3">
      <p className="line-clamp-2 text-xs text-neutral-400">请求：{proposal.requestText}</p>
      <div className="mt-1.5">
        <StyleDiff summary={proposal.diffSummary} />
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label="批准该提案"
          onClick={() => act('approve')}
          className={
            armed === 'approve'
              ? 'rounded border border-emerald-400 bg-emerald-950 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-900'
              : 'rounded border border-emerald-600 px-2 py-0.5 text-xs text-emerald-400 hover:bg-emerald-950'
          }
        >
          {armed === 'approve' ? '确认生效？' : '批准'}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label="拒绝该提案"
          onClick={() => act('reject')}
          className={
            armed === 'reject'
              ? 'rounded border border-red-500 bg-red-950 px-2 py-0.5 text-xs text-red-200 hover:bg-red-900'
              : 'rounded border border-neutral-600 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800'
          }
        >
          {armed === 'reject' ? '确认拒绝？' : '拒绝'}
        </button>
      </div>
    </li>
  );
}
