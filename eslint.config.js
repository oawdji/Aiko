// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.venv/**', '**/data/**', '**/*.d.ts'] },
  ...tseslint.configs.recommended,
);