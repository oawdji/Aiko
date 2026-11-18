import { describe, expect, it } from 'vitest';
import type { PersonaEvolvable } from '@aiko/shared';
import { renderPersonaStyleSection } from '../render';

const base: PersonaEvolvable = {
  verbosity: 'balanced',
  warmth: 0.6,
  humor: 0.3,
  proactiveQuestions: 0.4,
  notes: [],
};

describe('renderPersonaStyleSection', () => {
  it('renders all dims with anchors and version', () => {
    const s = renderPersonaStyleSection(base, 1);
    expect(s).toContain('[表达风格配置 v1]');
    expect(s).toContain('回答长度：均衡');
    expect(s).toContain('语气温度：60%（居中，介于“疏离克制”与“热切温暖”之间）');
    expect(s).toContain('幽默程度：30%（偏向“严肃正经”）');
    expect(s).toContain('主动追问：40%（居中');
    expect(s).toContain('用户偏好备注：无');
    expect(s).toContain('不是对话指令');
  });

  it('renders notes and version when present', () => {
    const s = renderPersonaStyleSection({ ...base, notes: ['偏好代码话题'] }, 3);
    expect(s).toContain('[表达风格配置 v3]');
    expect(s).toContain('用户偏好备注：偏好代码话题');
  });

  it('marks low values toward the low anchor', () => {
    const s = renderPersonaStyleSection({ ...base, humor: 0.1 }, 1);
    expect(s).toContain('幽默程度：10%（偏向“严肃正经”）');
  });
});
