import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonaProposalDTOSchema } from '@aiko/shared';
import {
  approvePersonaProposal,
  fetchPersonaProposals,
  fetchPersonaVersions,
  proposePersona,
  rejectPersonaProposal,
  rollbackPersonaVersion,
} from '../persona-api';

const proposal = PersonaProposalDTOSchema.parse({
  id: 'prop_1',
  agentId: 'agent-default',
  baseVersion: 1,
  requestText: '幽默一点',
  patch: { humor: 0.5 },
  diffSummary: '- 幽默程度：30% → 50%',
  status: 'pending',
  source: 'user_request',
  expiresAt: '2026-11-17T12:00:00.000Z',
  createdAt: '2026-11-16T12:00:00.000Z',
  reviewedAt: null,
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persona-api domain functions', () => {
  it('fetches versions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ versions: [{ version: 1, personaCoreHash: 'h', evolvable: {
        verbosity: 'balanced', warmth: 0.6, humor: 0.3, proactiveQuestions: 0.4, notes: [],
      }, isActive: true, createdAt: '2026-11-16T00:00:00.000Z', activatedAt: null }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const versions = await fetchPersonaVersions();
    expect(versions).toHaveLength(1);
    expect(versions[0]!.version).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/persona/versions', expect.objectContaining({ method: 'GET' }));
  });

  it('fetches proposals with status filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ proposals: [proposal] }));
    vi.stubGlobal('fetch', fetchMock);
    const proposals = await fetchPersonaProposals({ status: 'pending' });
    expect(proposals).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/persona/proposals?status=pending',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('proposes via POST with JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(proposal, 201));
    vi.stubGlobal('fetch', fetchMock);
    const p = await proposePersona('幽默一点');
    expect(p.id).toBe('prop_1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/persona/propose',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('approves via POST approve', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, version: 2, evolvable: {
        verbosity: 'balanced', warmth: 0.6, humor: 0.5, proactiveQuestions: 0.4, notes: [],
      } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await approvePersonaProposal('prop_1');
    expect(r.version).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/persona/proposals/prop_1/approve',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects via POST reject', async () => {
    const rejected = { ...proposal, status: 'rejected' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(rejected));
    vi.stubGlobal('fetch', fetchMock);
    const p = await rejectPersonaProposal('prop_1');
    expect(p.status).toBe('rejected');
  });

  it('rolls back via POST rollback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, version: 3, evolvable: {
        verbosity: 'balanced', warmth: 0.6, humor: 0.3, proactiveQuestions: 0.4, notes: [],
      } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await rollbackPersonaVersion(1);
    expect(r.version).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/persona/versions/1/rollback',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
