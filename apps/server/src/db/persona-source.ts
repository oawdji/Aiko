import { createHash } from 'node:crypto';

export type PersonaSeedSource = {
  personaCoreMd: string;
  personaCoreHash: string;
  evolvableJson: string;
};

export const PERSONA_CORE_BEGIN = '<!-- PERSONA_CORE_BEGIN -->';
export const PERSONA_CORE_END = '<!-- PERSONA_CORE_END -->';

export type PersonaSourceMarkers = {
  begin: string;
  end: string;
  /** 仅用于错误信息中的文件名提示 */
  name: string;
};

const DEFAULT_MARKERS: PersonaSourceMarkers = {
  begin: PERSONA_CORE_BEGIN,
  end: PERSONA_CORE_END,
  name: 'persona-core.md',
};

/**
 * 从锚点文档提取 seed 数据（唯一事实来源：docs/persona-core.md）。
 * 该文件是人格锚点的唯一事实来源（database-schema.md §6.2），
 * 生成器与 seed 逻辑都必须经过本函数，禁止在代码中维护第二份锚点文本。
 */
export function extractPersonaSeedSource(
  source: string,
  markers: PersonaSourceMarkers = DEFAULT_MARKERS,
): PersonaSeedSource {
  const begin = source.indexOf(markers.begin);
  const end = source.indexOf(markers.end);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      markers.name + ' 缺少 ' + markers.begin + '/' + markers.end + ' 标记区或标记顺序错误',
    );
  }

  const personaCoreMd = source.slice(begin + markers.begin.length, end).trim() + '\n';
  const personaCoreHash = createHash('sha256')
    .update(personaCoreMd, 'utf-8')
    .digest('hex');

  const jsonMatch = source.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch?.[1]) {
    throw new Error(markers.name + ' 缺少初始 evolvable_json 代码块');
  }
  const evolvableJson =
    JSON.stringify(JSON.parse(jsonMatch[1]), null, 2) + '\n';

  return { personaCoreMd, personaCoreHash, evolvableJson };
}