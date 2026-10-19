import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import jestDomPlugin from 'eslint-plugin-jest-dom';
import testingLibraryPlugin from 'eslint-plugin-testing-library';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  {
    ignores: ['node_modules/**', 'build/**', '.next/**', 'coverage/**', 'public/**'],
  },
  js.configs.recommended,
  ...compat.extends('plugin:react/recommended'),
  ...compat.extends('plugin:@typescript-eslint/recommended'),
  ...compat.extends('plugin:jest-dom/recommended'),
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        cy: 'readonly',
        // browser
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        // node
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        // jest/vitest
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react: reactPlugin,
      'jest-dom': jestDomPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-console': 'off',
      'linebreak-style': ['error', 'unix'],
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
      'react/prop-types': 0,
      'react/display-name': 0,
      'react/react-in-jsx-scope': 0,
      'jest-dom/prefer-checked': 'error',
      'jest-dom/prefer-enabled-disabled': 'error',
      'jest-dom/prefer-required': 'error',
      'jest-dom/prefer-to-have-attribute': 'error',
      'no-debugger': 'off',
    },
  },
  {
    // CommonJS modules loaded by next.config.js
    files: ['next.config.js', 'lib/csp.js', 'lib/colorModeScript.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/__tests__/**/*.{ts,tsx,js,jsx}', '**/*.{spec,test}.{ts,tsx,js,jsx}'],
    plugins: {
      'testing-library': testingLibraryPlugin,
    },
    rules: {
      ...testingLibraryPlugin.configs['flat/react'].rules,
      'testing-library/await-async-queries': 'error',
      'testing-library/no-await-sync-queries': 'error',
      'testing-library/no-debugging-utils': 'off',
      'testing-library/no-dom-import': 'off',
      'testing-library/no-manual-cleanup': 'warn',
      'testing-library/await-async-events': 'warn',
    },
  },
];
