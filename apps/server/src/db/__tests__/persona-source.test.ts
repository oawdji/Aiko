import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { extractPersonaSeedSource } from '../persona-source';

const SAMPLE = `
# 标题（标记区外内容，应被忽略）

<!-- PERSONA_CORE_V1_BEGIN -->

你是 Aiko，一个运行在用户本机的拟人化聊天角色。

<!-- PERSONA_CORE_V1_END -->

## 3. 初始 evolvable_json

\`\`\`json
{
  "verbosity": "balanced"
}
\`\`\`
`;

describe('extractPersonaSeedSource', () => {
  it('extracts marker content, hash, and pretty-printed JSON', () => {
    const result = extractPersonaSeedSource(SAMPLE);

    expect(result.personaCoreMd).toBe(
      '你是 Aiko，一个运行在用户本机的拟人化聊天角色。\n',
    );
    expect(result.personaCoreHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.personaCoreHash).toBe(
      createHash('sha256')
        .update(result.personaCoreMd, 'utf-8')
        .digest('hex'),
    );
    expect(JSON.parse(result.evolvableJson)).toEqual({
      verbosity: 'balanced',
    });
  });

  it('produces identical hash for identical content regardless of surrounding text', () => {
    const a = extractPersonaSeedSource(`前缀 ${SAMPLE} 后缀`);
    const b = extractPersonaSeedSource(SAMPLE);
    expect(a.personaCoreHash).toBe(b.personaCoreHash);
  });

  it('throws when markers are missing', () => {
    expect(() => extractPersonaSeedSource('没有标记的文档')).toThrow(
      /标记区/,
    );
  });

  it('throws when the evolvable json block is missing', () => {
    expect(() =>
      extractPersonaSeedSource(
        '<!-- PERSONA_CORE_V1_BEGIN -->内容<!-- PERSONA_CORE_V1_END -->',
      ),
    ).toThrow(/evolvable_json/);
  });
});