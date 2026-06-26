// Flat ESLint config. Lints the TypeScript sources and the .mjs tooling; the
// renderer JS (browser globals), generated output, and Claude Code workflow
// scripts under .claude/ (which run in the Workflow runtime with injected
// globals like agent()/phase()/parallel()) are excluded.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'coverage/**',
      'packages/gui/renderer/**',
      'packages/gui/judge/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
  },
);
