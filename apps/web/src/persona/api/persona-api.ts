import {
  PersonaMutationResponseSchema,
  PersonaProposalDTOSchema,
  PersonaProposalListResponseSchema,
  PersonaVersionListResponseSchema,
  type PersonaMutationResponse,
  type PersonaProposalDTO,
  type PersonaProposalStatus,
  type PersonaVersionDTO,
} from '@aiko/shared';
import { requestJson, type RequestOptions } from '../../shared/api/client';

/**
 * 人格演化领域函数（组件不直接 fetch，react-architecture §10 边界）。
 * 两步确认在组件层；这里只负责契约校验的真实请求。
 */

export function fetchPersonaVersions(
  options: RequestOptions = {},
): Promise<PersonaVersionDTO[]> {
  return requestJson('/persona/versions', PersonaVersionListResponseSchema, options).then(
    (r) => r.versions,
  );
}

export function fetchPersonaProposals(
  query: { status?: PersonaProposalStatus; agentId?: string } = {},
  options: RequestOptions = {},
): Promise<PersonaProposalDTO[]> {
  const sp = new URLSearchParams();
  if (query.status) sp.set('status', query.status);
  if (query.agentId) sp.set('agentId', query.agentId);
  const qs = sp.toString();
  return requestJson(
    `/persona/proposals${qs ? '?' + qs : ''}`,
    PersonaProposalListResponseSchema,
    options,
  ).then((r) => r.proposals);
}

export function proposePersona(
  requestText: string,
  options: RequestOptions = {},
): Promise<PersonaProposalDTO> {
  return requestJson('/persona/propose', PersonaProposalDTOSchema, {
    ...options,
    method: 'POST',
    body: { requestText },
  });
}

export function approvePersonaProposal(
  id: string,
  options: RequestOptions = {},
): Promise<PersonaMutationResponse> {
  return requestJson(`/persona/proposals/${encodeURIComponent(id)}/approve`, PersonaMutationResponseSchema, {
    ...options,
    method: 'POST',
  });
}

export function rejectPersonaProposal(
  id: string,
  options: RequestOptions = {},
): Promise<PersonaProposalDTO> {
  return requestJson(`/persona/proposals/${encodeURIComponent(id)}/reject`, PersonaProposalDTOSchema, {
    ...options,
    method: 'POST',
  });
}

export function rollbackPersonaVersion(
  version: number,
  options: RequestOptions = {},
): Promise<PersonaMutationResponse> {
  return requestJson(`/persona/versions/${version}/rollback`, PersonaMutationResponseSchema, {
    ...options,
    method: 'POST',
  });
}
