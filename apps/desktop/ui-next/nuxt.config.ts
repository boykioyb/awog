export default defineNuxtConfig({
  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt', '@nuxt/eslint'],
  // Flat-config ESLint (ESLint 9). Stylistic rules off — Prettier owns formatting.
  eslint: {
    config: { stylistic: false },
    checker: false,
  },
  // Shadcn-vue `ui/<x>/index.ts` barrels stay out of the component auto-scan
  // (each re-exports a same-named `<X>.vue` → name collision otherwise).
  components: [{ path: '~/components', pathPrefix: false, ignore: ['ui/**/index.ts'] }],
  // Tailwind base/components/utilities come from main.css (module prepends it),
  // then the ported prototype design system, then app-shell overrides last so
  // the full-window shell wins over the prototype's centered-showcase framing.
  tailwindcss: { cssPath: '~/assets/css/main.css' },
  css: [
    '~/assets/css/prototype.css',
    '~/assets/css/app-shell.css',
    '@vue-flow/core/dist/style.css',
    '@vue-flow/core/dist/theme-default.css',
    '@vue-flow/controls/dist/style.css',
    '@vue-flow/minimap/dist/style.css',
  ],
  devtools: { enabled: true },
  // 3031 so ui-next can run side-by-side with the legacy ui (3030) during rebuild.
  devServer: { port: 3031 },
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
