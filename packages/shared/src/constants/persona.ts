/**
 * 人格演化常量（受控人格演化 P1 起逐步启用）。
 * - 幅度/频率限制：propose 校验与前端展示共用；
 * - 锚点词表：server 渲染 system 风格段与前端面板共用（借鉴 OpenHer signal_buckets 设计）。
 */

/** 数值字段单次变化上限（超过则拒绝提案，提示分多次调整）。 */
export const PERSONA_MAX_STEP = 0.2;
/** notes 总条数上限（第一期 patch 不允许修改 notes，字段保留）。 */
export const PERSONA_NOTES_MAX = 5;
export const PERSONA_NOTE_MAX_LEN = 100;
/** 同一 Agent 同时允许的 pending 提案数。 */
export const PERSONA_PENDING_MAX = 1;
/** 提案有效期（小时）。 */
export const PERSONA_PROPOSAL_TTL_HOURS = 24;
/** 两次提案之间的冷却时间（分钟）。 */
export const PERSONA_PROPOSAL_COOLDOWN_MINUTES = 60;

/** 每个可演化维度的展示标签与锚点词（low = 0 端，high = 1 端）。 */
export const PERSONA_ANCHORS = {
  verbosity: {
    label: '回答长度',
    lowAnchor: '惜字如金',
    highAnchor: '展开细说',
    values: { concise: '简洁', balanced: '均衡', detailed: '详细' },
  },
  warmth: { label: '语气温度', lowAnchor: '疏离克制', highAnchor: '热切温暖' },
  humor: { label: '幽默程度', lowAnchor: '严肃正经', highAnchor: '俏皮玩梗' },
  proactiveQuestions: { label: '主动追问', lowAnchor: '很少反问', highAnchor: '积极追问' },
} as const;
