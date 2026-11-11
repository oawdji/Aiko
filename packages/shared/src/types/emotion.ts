export type AgentEmotionState = {
  valence: number;
  arousal: number;
};

export type EmotionTag =
  | 'calm'
  | 'curious'
  | 'happy'
  | 'low'
  | 'tense'
  | 'neutral';