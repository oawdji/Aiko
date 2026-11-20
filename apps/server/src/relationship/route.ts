import { Hono } from 'hono';
import { getDb } from '../db';
import { getRelationshipStateResponse } from './service';

/** GET /api/agents/:agentId/relationship（关系阶段：成长体验） */
export const relationshipRoute = new Hono().get('/agents/:agentId/relationship', (c) => {
  const agentId = c.req.param('agentId');
  return c.json(getRelationshipStateResponse(getDb(), agentId, new Date().toISOString()));
});