import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'eval/reports/**',
      '**/coverage/**',
      'plugin/server/**',
    ],
  },
  {
    // Runs inside the user's browser tab (see plugin/skills/check-this-page/SKILL.md).
    files: ['plugin/skills/**/*.js'],
    languageOptions: { globals: { document: 'readonly', location: 'readonly' } },
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } },
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
