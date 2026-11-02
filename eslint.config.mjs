import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** API and packages. The web app uses Next's own ESLint config. */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/src/generated/**', 'apps/web/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // An un-awaited write fails silently: make it a lint error in the API.
    files: ['apps/api/src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['packages/widget/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
