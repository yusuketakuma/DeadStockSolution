import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const commonTsRules = {
  'no-undef': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unused-vars': 'off',
  '@typescript-eslint/ban-ts-comment': 'off',
  '@typescript-eslint/no-non-null-assertion': 'off',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'server/drizzle/**',
      'client/vite.config.ts.timestamp-*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...commonTsRules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      ...commonTsRules,
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      ...commonTsRules,
    },
  },
);
