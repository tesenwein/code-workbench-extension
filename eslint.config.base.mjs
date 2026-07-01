import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Shared base ESLint flat config for every workspace package.
 *
 * Usage in a package's `eslint.config.mjs`:
 *
 *   import tseslint from 'typescript-eslint';
 *   import { baseConfig, prettierConfig } from '../../eslint.config.base.mjs';
 *
 *   export default tseslint.config(
 *     { ignores: ['dist/**'] },
 *     ...baseConfig,
 *     // package-specific overrides here
 *     prettierConfig, // keep last
 *   );
 */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Project-wide rule tweaks shared by all packages.
  {
    files: ['**/*.{ts,tsx,mjs,cjs,js}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
];

/** Disables ESLint rules that conflict with Prettier. Spread this LAST. */
export const prettierConfig = prettier;
