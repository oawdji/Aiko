import { z } from 'zod';

/** PAD 三维情感状态（emotion-rules-v2 起），各维 [-1, 1]。见 technical-design.md §10.5。 */
export const AgentEmotionStateSchema = z.object({
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(-1).max(1),
  dominance: z.number().min(-1).max(1),
});
