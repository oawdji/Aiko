import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  DEFAULT_AGENT_ID,
  PersonaProposeBodySchema,
  PersonaProposalStatusSchema,
  type ApiError,
} from '@aiko/shared';
import { getDb } from '../db';
import {
  approveProposal,
  listPersonaVersions,
  listProposals,
  proposePersona,
  rejectProposal,
  rollbackToVersion,
} from './service';
import {
  PersonaBaseChangedError,
  PersonaNoActivePersonaError,
  PersonaPatchError,
  PersonaProposalNotFoundError,
  PersonaProposalStateError,
  PersonaRateLimitedError,
  PersonaVersionNotFoundError,
} from './errors';

function errorBody(code: ApiError['code'], message: string): ApiError {
  return { code, message };
}

function handleError(c: Context, error: unknown): Response {
  if (error instanceof PersonaProposalNotFoundError) {
    return c.json(errorBody('PERSONA_PROPOSAL_NOT_FOUND', error.message), 404);
  }
  if (error instanceof PersonaVersionNotFoundError) {
    return c.json(errorBody('PERSONA_VERSION_NOT_FOUND', error.message), 404);
  }
  if (error instanceof PersonaProposalStateError) {
    return c.json(errorBody('PERSONA_PROPOSAL_STATE', error.message), 409);
  }
  if (error instanceof PersonaBaseChangedError) {
    return c.json(errorBody('PERSONA_BASE_CHANGED', error.message), 409);
  }
  if (error instanceof PersonaRateLimitedError) {
    return c.json(errorBody('PERSONA_RATE_LIMITED', error.message), 429);
  }
  if (error instanceof PersonaPatchError) {
    return c.json(errorBody('PERSONA_PATCH_INVALID', error.message), 422);
  }
  if (error instanceof PersonaNoActivePersonaError) {
    return c.json(errorBody('PERSONA_NO_ACTIVE', error.message), 500);
  }
  console.error('[persona] route error:', error);
  return c.json(errorBody('INTERNAL_ERROR', 'Internal server error'), 500);
}

function resolveAgentId(query: string | undefined): string {
  return query && query.length > 0 ? query : DEFAULT_AGENT_ID;
}

/**
 * 人格演化接口（api-contract §22.2）：
 * 所有写路径都必须经过显式动作（propose / approve / reject / rollback）；
 * 聊天消息、流式回复与检索内容在结构上无任何 persona 写入口（F26）。
 */
export const personaRoute = new Hono()
  .post('/persona/propose', async (c) => {
    let raw: unknown;
    try {
      raw = JSON.parse(await c.req.text());
    } catch {
      return c.json(errorBody('INVALID_REQUEST', 'Request body must be valid JSON'), 400);
    }
    const parsed = PersonaProposeBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(errorBody('INVALID_REQUEST', 'Validation failed'), 400);
    }
    try {
      const proposal = await proposePersona(getDb(), {
        agentId: parsed.data.agentId ?? DEFAULT_AGENT_ID,
        requestText: parsed.data.requestText,
        now: new Date().toISOString(),
      });
      return c.json(proposal, 201);
    } catch (error) {
      return handleError(c, error);
    }
  })
  .get('/persona/proposals', (c) => {
    const agentId = resolveAgentId(c.req.query('agentId'));
    const statusRaw = c.req.query('status');
    let status;
    if (statusRaw) {
      const parsed = PersonaProposalStatusSchema.safeParse(statusRaw);
      if (!parsed.success) {
        return c.json(errorBody('INVALID_REQUEST', 'Invalid status filter'), 400);
      }
      status = parsed.data;
    }
    return c.json({ proposals: listProposals(getDb(), agentId, { status }) });
  })
  .post('/persona/proposals/:id/approve', (c) => {
    const id = c.req.param('id');
    try {
      const result = approveProposal(
        getDb(),
        resolveAgentId(c.req.query('agentId')),
        id,
        new Date().toISOString(),
      );
      return c.json({ ok: true, version: result.version, evolvable: result.evolvable });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .post('/persona/proposals/:id/reject', (c) => {
    const id = c.req.param('id');
    try {
      const proposal = rejectProposal(
        getDb(),
        resolveAgentId(c.req.query('agentId')),
        id,
        new Date().toISOString(),
      );
      return c.json(proposal);
    } catch (error) {
      return handleError(c, error);
    }
  })
  .get('/persona/versions', (c) => {
    const agentId = resolveAgentId(c.req.query('agentId'));
    return c.json({ versions: listPersonaVersions(getDb(), agentId) });
  })
  .post('/persona/versions/:version/rollback', (c) => {
    const version = Number(c.req.param('version'));
    if (!Number.isInteger(version) || version < 1) {
      return c.json(errorBody('INVALID_REQUEST', 'version must be a positive integer'), 400);
    }
    try {
      const result = rollbackToVersion(
        getDb(),
        resolveAgentId(c.req.query('agentId')),
        version,
        new Date().toISOString(),
      );
      return c.json({ ok: true, version: result.version, evolvable: result.evolvable });
    } catch (error) {
      return handleError(c, error);
    }
  });
