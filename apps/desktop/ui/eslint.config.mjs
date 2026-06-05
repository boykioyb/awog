// @ts-check
// Flat-config ESLint (ESLint 9) — replaces the legacy Airbnb `.eslintrc.cjs`.
// Base rules come from `@nuxt/eslint` (typescript-eslint + eslint-plugin-vue +
// Nuxt-aware import/auto-import handling). Formatting is owned by Prettier
// (`stylistic: false` in nuxt.config + eslint-plugin-prettier last), so ESLint
// only enforces code-quality rules here.
import withNuxt from './.nuxt/eslint.config.mjs'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'

export default withNuxt(
  {
    ignores: ['public/**', '**/*.json', 'pnpm-lock.yaml', 'dist', '.output'],
  },
  {
    // typescript-eslint rules need the TS parser — scope to TS/Vue so they
    // don't run on plain `.mjs`/`.js` config files (espree, no parser services).
    files: ['**/*.ts', '**/*.tsx', '**/*.vue'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `delete record[key]` on `Record<string, T>` caches is an established
      // pattern here (per-project cache invalidation). Airbnb never flagged it.
      '@typescript-eslint/no-dynamic-delete': 'off',
      // Vue's `defineEmits<{ (e:'a',…); (e:'b',…) }>()` uses one call signature
      // per event by convention — don't merge them.
      '@typescript-eslint/unified-signatures': 'off',
      // ── Vue (only fire on .vue) ──
      'vue/multi-word-component-names': 'off',
      // Vue 3 SFCs may have multiple template roots (fragments). Original config
      // disabled this too.
      'vue/no-multiple-template-root': 'off',
      'vue/component-name-in-template-casing': [
        'error',
        'PascalCase',
        { registeredComponentsOnly: false },
      ],
      // `vue/component-tags-order` was renamed to `vue/block-order` in
      // eslint-plugin-vue 9.16+. Keep the same template → script → style order.
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
  // Prettier owns formatting — must be last so eslint-config-prettier disables
  // any stylistic rules that would conflict with it.
  eslintPluginPrettierRecommended,
)
