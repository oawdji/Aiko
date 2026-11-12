/**
 * 词典线索：关键词的三维 PAD delta 与置信度。
 * 纯数据文件，抽取逻辑见 emotion-rules.ts（数据与逻辑解耦）。
 */
export type EmotionClue = {
  keyword: string;
  dValence: number;
  dArousal: number;
  dDominance: number;
  confidence: number;
};

/**
 * emotion-rules-v2 规则词典（PAD 三维，technical-design.md §10.3）：
 * - valence/arousal 沿用 v1 数值；
 * - dominance 仅少量低置信线索（文本支配感线索弱，宁缺勿噪）；
 * - 修改词典必须递增 EMOTION_RULES_VERSION（emotion-rules.ts）。
 */
export const EMOTION_CLUES: readonly EmotionClue[] = [
  // —— v1 情绪线索（dominance 恒为 0）——
  { keyword: '开心', dValence: 0.12, dArousal: 0.08, dDominance: 0, confidence: 0.7 },
  { keyword: '高兴', dValence: 0.12, dArousal: 0.08, dDominance: 0, confidence: 0.7 },
  { keyword: '喜欢', dValence: 0.08, dArousal: 0.0, dDominance: 0, confidence: 0.6 },
  { keyword: '有趣', dValence: 0.1, dArousal: 0.06, dDominance: 0, confidence: 0.6 },
  { keyword: '累', dValence: -0.1, dArousal: -0.04, dDominance: 0, confidence: 0.7 },
  { keyword: '难过', dValence: -0.14, dArousal: -0.06, dDominance: 0, confidence: 0.75 },
  { keyword: '烦', dValence: -0.1, dArousal: 0.06, dDominance: 0, confidence: 0.65 },
  { keyword: '焦虑', dValence: -0.08, dArousal: 0.12, dDominance: 0, confidence: 0.7 },
  { keyword: '激动', dValence: 0.04, dArousal: 0.14, dDominance: 0, confidence: 0.65 },
  { keyword: '紧张', dValence: -0.06, dArousal: 0.12, dDominance: 0, confidence: 0.7 },
  { keyword: '平静', dValence: 0.04, dArousal: -0.08, dDominance: 0, confidence: 0.6 },
  // —— v2 新增支配度线索（低置信）——
  { keyword: '听我的', dValence: 0, dArousal: 0.04, dDominance: -0.06, confidence: 0.5 },
  { keyword: '帮帮我', dValence: 0, dArousal: 0.05, dDominance: -0.04, confidence: 0.5 },
  { keyword: '没问题', dValence: 0.04, dArousal: -0.02, dDominance: 0.05, confidence: 0.5 },
  { keyword: '包在我身上', dValence: 0.04, dArousal: 0.06, dDominance: 0.06, confidence: 0.5 },
];
