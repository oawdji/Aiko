import { createHash } from 'node:crypto';

export type PersonaSeedSource = {
  personaCoreMd: string;
  personaCoreHash: string;
  evolvableJson: string;
};

const BEGIN_MARKER = '<!-- PERSONA_CORE_V1_BEGIN -->';
const END_MARKER = '<!-- PERSONA_CORE_V1_END -->';

/**
 * 从 docs/persona-core-v1.md 提取 seed 数据。
 * 该文件是人格锚点的唯一事实来源（database-schema.md §6.2），
 * 生成器与 seed 逻辑都必须经过本函数，禁止在代码中维护第二份锚点文本。
 */
export function extractPersonaSeedSource(source: string): PersonaSeedSource {
  const begin = source.indexOf(BEGIN_MARKER);
  const end = source.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      'persona-core-v1.md 缺少 PERSONA_CORE_V1_BEGIN/END 标记区或标记顺序错误',
    );
  }

  const personaCoreMd = source.slice(begin + BEGIN_MARKER.length, end).trim() + '\n';
  const personaCoreHash = createHash('sha256')
    .update(personaCoreMd, 'utf-8')
    .digest('hex');

  const jsonMatch = source.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch?.[1]) {
    throw new Error('persona-core-v1.md 缺少初始 evolvable_json 代码块');
  }
  const evolvableJson =
    JSON.stringify(JSON.parse(jsonMatch[1]), null, 2) + '\n';

  return { personaCoreMd, personaCoreHash, evolvableJson };
}