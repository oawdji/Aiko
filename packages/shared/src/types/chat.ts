// 类型本体与校验规则统一由 schemas/api.ts 的 Zod schema 推导（M2.1）。
export type {
  ChatMessageRole,
  ChatMessageStatus,
  ChatMessageDTO,
} from '../schemas/api';