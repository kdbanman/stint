// Flat ESLint config. Lints the TypeScript sources and the .mjs tooling; the
// renderer JS (browser globals), generated output, and the agent skills under
// .claude/ (Markdown procedures, nothing lintable) are excluded.
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
      // The QA discovery driver — like the judge, a Playwright harness whose page-context
      // snippets need browser globals; excluded on the same grounds.
      'packages/gui/qa/**',
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
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
  },
);
