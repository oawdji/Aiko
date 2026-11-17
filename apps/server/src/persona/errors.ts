/** patch 校验失败（空补丁 / 超幅度 / LLM 输出无法解析）。 */
export class PersonaPatchError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'PersonaPatchError';
  }
}

export class PersonaProposalNotFoundError extends Error {
  constructor(proposalId: string) {
    super(`Persona proposal "${proposalId}" not found for this agent`);
    this.name = 'PersonaProposalNotFoundError';
  }
}

/** 提案状态不允许该操作（非 pending / 已过期 / 版本已激活）。 */
export class PersonaProposalStateError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'PersonaProposalStateError';
  }
}

/** 频率限制：已有 pending 或冷却期内。 */
export class PersonaRateLimitedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'PersonaRateLimitedError';
  }
}

/** 并发守卫：提案基于的版本已不是当前活跃版本。 */
export class PersonaBaseChangedError extends Error {
  constructor(baseVersion: number, activeVersion: number) {
    super(
      `Proposal base version ${baseVersion} is stale (active is ${activeVersion}); regenerate the proposal`,
    );
    this.name = 'PersonaBaseChangedError';
  }
}

export class PersonaNoActivePersonaError extends Error {
  constructor(agentId: string) {
    super(`Agent ${agentId} has no active persona version`);
    this.name = 'PersonaNoActivePersonaError';
  }
}

export class PersonaVersionNotFoundError extends Error {
  constructor(version: number) {
    super(`Persona version ${version} not found for this agent`);
    this.name = 'PersonaVersionNotFoundError';
  }
}
