/* eslint-disable */
module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
    extraFileExtensions: ['.vue'],
  },
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
    'plugin:vue/vue3-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  plugins: ['@typescript-eslint', 'vue'],
  settings: {
    'import/resolver': {
      typescript: { project: './tsconfig.json' },
      node: { extensions: ['.js', '.ts', '.vue'] },
    },
  },
  rules: {
    // Style dự án: không dùng dấu chấm phẩy
    semi: ['error', 'never'],
    '@typescript-eslint/semi': ['error', 'never'],
    'prettier/prettier': 'error',

    // Nuxt: auto-import, alias ~/, extension .vue → tắt rule import gây nhiễu
    'import/no-unresolved': 'off',
    'import/extensions': 'off',
    'import/prefer-default-export': 'off',
    'import/no-extraneous-dependencies': 'off',
    'no-undef': 'off', // Nuxt auto-import nhiều global

    // Vue
    'vue/multi-word-component-names': 'off',
    'vue/no-multiple-template-root': 'off',
    'vue/component-name-in-template-casing': ['error', 'PascalCase', { registeredComponentsOnly: false }],
    'vue/component-tags-order': ['error', { order: ['template', 'script', 'style'] }],
    'vue/html-self-closing': ['error', {
      html: { void: 'always', normal: 'always', component: 'always' },
    }],

    // TypeScript
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

    // Airbnb override cho phù hợp dự án
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-underscore-dangle': 'off',
    'max-len': 'off', // để Prettier lo
    'no-param-reassign': ['error', { props: false }], // Pinia store mutate state
    'class-methods-use-this': 'off',
    // Cho phép trong code thuật toán (topo sort, mock generator)
    'no-plusplus': 'off',
    'no-continue': 'off',
  },
  overrides: [],
  ignorePatterns: [
    '.nuxt',
    '.output',
    'dist',
    'node_modules',
    'public',
    'pnpm-lock.yaml',
  ],
}
