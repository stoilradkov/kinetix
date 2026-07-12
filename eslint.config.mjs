import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/routeTree.gen.ts',
      '**/.turbo/**',
      '**/.vite/**',
      'eslint.config.mjs',
      'prettier.config.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true },
    },
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['apps/kin/**/*.ts', 'packages/**/*.ts', '*.config.{js,mjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.test.ts', '**/test/**/*.ts', 'packages/db/drizzle.config.ts'],
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: ['Route', 'buttonVariants'],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/components/projects-table.tsx'],
    rules: {
      'react-hooks/incompatible-library': 'off',
    },
  },
  {
    files: ['apps/web/src/routes/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  prettier,
);
