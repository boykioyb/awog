export default defineNuxtConfig({
  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt', '@nuxt/eslint'],
  // Flat-config ESLint (ESLint 9). Stylistic rules off — Prettier owns
  // formatting (see eslint.config.mjs + .prettierrc). Checker off so the dev
  // server doesn't run ESLint inline (avoids extra peer deps).
  eslint: {
    config: { stylistic: false },
    checker: false,
  },
  components: [{ path: '~/components', pathPrefix: false }],
  css: [
    '~/assets/css/main.css',
    '@vue-flow/core/dist/style.css',
    '@vue-flow/core/dist/theme-default.css',
    '@vue-flow/controls/dist/style.css',
    '@vue-flow/minimap/dist/style.css',
  ],
  devtools: { enabled: true },
  devServer: { port: 3030 },
  ssr: false,
  app: {
    head: {
      title: 'AWOG',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { charset: 'utf-8' },
      ],
    },
  },
  typescript: {
    strict: true,
    typeCheck: false,
  },
  compatibilityDate: '2026-05-25',
})
