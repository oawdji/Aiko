import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractPersonaSeedSource } from '../src/db/persona-source';

// scripts -> apps/server 为上一级，仓库根为上三级
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const sourcePath = path.join(repoRoot, 'docs', 'persona-core-v1.md');
const outPath = path.resolve(
  import.meta.dirname,
  '../src/db/generated/persona-core.ts',
);

const seed = extractPersonaSeedSource(readFileSync(sourcePath, 'utf-8'));

const file = `// 由 pnpm gen:persona 自动生成，来源：docs/persona-core-v1.md
// （标记区正文 + 初始 evolvable 配置）。请勿手动修改本文件；
// 调整锚点内容请编辑源文档后重新生成。

export const PERSONA_CORE_MD = ${JSON.stringify(seed.personaCoreMd)};

export const PERSONA_CORE_HASH = '${seed.personaCoreHash}';

export const INITIAL_EVOLVABLE_JSON = ${JSON.stringify(seed.evolvableJson)};
`;

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, file);

console.log(`persona-core.ts generated: ${outPath}`);
console.log(`persona_core_md length: ${seed.personaCoreMd.length} chars`);
console.log(`persona_core_hash: ${seed.personaCoreHash}`);