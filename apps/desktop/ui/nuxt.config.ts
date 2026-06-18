export default defineNuxtConfig({
  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt', '@nuxt/eslint'],
  // Flat-config ESLint (ESLint 9). Stylistic rules off — Prettier owns
  // formatting (see eslint.config.mjs + .prettierrc). Checker off so the dev
  // server doesn't run ESLint inline (avoids extra peer deps).
  eslint: {
    config: { stylistic: false },
    checker: false,
  },
  // `ignore` keeps the shadcn-vue `ui/<x>/index.ts` barrels out of component
  // auto-scan — each barrel re-exports a same-named `<X>.vue`, so registering
  // both collides on one name (the "Two component files…" warning). The barrels
  // stay importable as modules (cva variants + grouped exports) untouched.
  components: [{ path: '~/components', pathPrefix: false, ignore: ['ui/**/index.ts'] }],
  css: [
    // Self-hosted variable fonts (no CDN — local-first). Geist = the shadcn.com
    // typeface; selectable via Appearance → font, default for a readable look.
    '@fontsource-variable/geist',
    '@fontsource-variable/geist-mono',
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
