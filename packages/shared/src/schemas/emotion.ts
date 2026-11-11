import { z } from 'zod';

export const AgentEmotionStateSchema = z.object({
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(-1).max(1),
});