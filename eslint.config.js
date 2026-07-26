// Flat ESLint config. Lints the TypeScript sources, the .mjs tooling, and the renderer
// (classic scripts + the bundled SU entry — issue #83 turned the renderer's guards on);
// generated output and the agent skills under .claude/ (Markdown procedures, nothing
// lintable) are excluded.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
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
  {
    // The renderer's classic page scripts (issue #83): browser globals, script (not
    // module) source. Cross-file/page globals they share are declared here rather than
    // ignored: window.SU is typed by su.ts, and app.js's shared inline affordances are
    // reached as window.* properties (see renderer/globals.d.ts).
    files: ['packages/gui/renderer/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaVersion: 2023, sourceType: 'script' },
    },
    rules: {
      // tseslint's recommended set already applies its no-unused-vars here; keep the one
      // configured rule and silence the base duplicate.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // The judge and QA Playwright harnesses (issue #184). These were exempt on the grounds
    // that their page-context snippets need browser globals — the same problem issue #83
    // already solved for the renderer above, one languageOptions block away. Node globals
    // for the harness half, browser globals for the strings it evaluates in the page.
    files: ['packages/gui/judge/**/*.mjs', 'packages/gui/qa/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      // tseslint's recommended set already applies its no-unused-vars here; keep the one
      // configured rule and silence the base duplicate.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
