// @ts-check
// Flat-config ESLint (ESLint 9). Base rules from `@nuxt/eslint`; Prettier owns
// formatting (`stylistic: false` in nuxt.config + eslint-plugin-prettier last).
import withNuxt from './.nuxt/eslint.config.mjs'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'

export default withNuxt(
  {
    ignores: ['public/**', '**/*.json', 'pnpm-lock.yaml', 'dist', '.output'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.vue'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/unified-signatures': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-multiple-template-root': 'off',
      'vue/component-name-in-template-casing': [
        'error',
        'PascalCase',
        { registeredComponentsOnly: false },
      ],
      'vue/block-order': ['error', { order: ['template', 'script', 'style'] }],
      'vue/html-self-closing': [
        'error',
        { html: { void: 'always', normal: 'always', component: 'always' } },
      ],
    },
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  eslintPluginPrettierRecommended,
)
