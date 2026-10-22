import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import prettier from 'eslint-config-prettier/flat'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/dist-electron/**', '**/dist-bundle/**',
      '**/release/**', '**/coverage/**', '**/.cache/**', '**/*.d.ts',
      'packages/database/src/generated/**', '**/tmp/**', '**/temp/**', 'deploy/**'
    ]
  },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.{js,cjs,mjs,ts,cts,mts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': 'off',
      'no-debugger': 'error'
    }
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tsParser, extraFileExtensions: ['.vue'] } },
    rules: {
      // TypeScript checks undefined identifiers, including imported and global types.
      'no-undef': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn'
    }
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['**/*.{test,spec}.{ts,mts,js,mjs}', '**/__tests__/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' }
  },
  // Formatting belongs to Prettier; ESLint checks correctness without rewriting files.
  prettier
]
