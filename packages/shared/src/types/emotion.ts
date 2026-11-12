import { z } from 'zod';

import { AgentEmotionStateSchema } from '../schemas/emotion';

// 与情绪相关的数值/标签类型统一由 schema 推导（M2.1）。
export type { EmotionTag } from '../schemas/api';

export type AgentEmotionState = z.infer<typeof AgentEmotionStateSchema>;