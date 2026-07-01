import tseslint from 'typescript-eslint';
import globals from 'globals';
import { baseConfig, prettierConfig } from '../../eslint.config.base.mjs';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'out/**',
      'mcp-server/**',
      'node_modules/**',
      '*.config.{js,mjs,cjs,ts}',
      'esbuild.mjs',
    ],
  },
  ...baseConfig,
  // All source + build scripts — Node environment.
  {
    files: ['src/**/*.ts', '*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-control-regex': 'off',
    },
  },
  // Disable ESLint rules that conflict with Prettier — keep this last.
  prettierConfig,
);
