import { describe, expect, it, vi } from 'vitest';
import type { BootstrapResponse } from '@aiko/shared';
import { ApiClientError } from '../../shared/api/errors';
import { runBootstrap } from '../bootstrap-flow';

const okData = { agent: { id: 'agent-default' } } as unknown as BootstrapResponse;

describe('runBootstrap (M2.5)', () => {
  it('returns ready with validated data', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okData);
    const outcome = await runBootstrap(fetchFn);
    expect(outcome).toEqual({ status: 'ready', data: okData });
    expect(fetchFn).toHaveBeenCalledWith('default');
  });

  it('maps ApiClientError code into outcome', async () => {
    const fetchFn = vi.fn().mockRejectedValue(
      new ApiClientError({ code: 'AGENT_NOT_FOUND', message: 'x', status: 404 }),
    );
    const outcome = await runBootstrap(fetchFn);
    expect(outcome).toEqual({ status: 'error', errorCode: 'AGENT_NOT_FOUND' });
  });

  it('maps unknown failures to INTERNAL_ERROR', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('boom'));
    const outcome = await runBootstrap(fetchFn);
    expect(outcome).toEqual({ status: 'error', errorCode: 'INTERNAL_ERROR' });
  });
});