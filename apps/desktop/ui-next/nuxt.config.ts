import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt', '@nuxt/eslint'],
  vite: {
    // Monaco is only ever dynamic-imported (kept out of the initial bundle). Left
    // undeclared, Vite's dev optimizer discovers it lazily and re-bundles mid-
    // session as its many internal/language modules surface — each re-optimize
    // rewrites the optimized-dep hash, and a dynamic import that races that window
    // 504s ("Failed to fetch dynamically imported module .../deps/monaco-editor.js").
    // Pre-bundling it at cold start makes the hash stable for the whole session.
    optimizeDeps: { include: ['monaco-editor'] },
    resolve: {
      alias: {
        // `monaco-themes` ships the curated theme JSON under ./themes, but its
        // package `exports` map only exposes parseTmTheme — a bare deep import
        // (`monaco-themes/themes/X.json`) is blocked. Alias the deep path to the
        // real folder so useMonacoTheme can lazy-import the JSON (ADR 0053).
        'monaco-themes/themes': fileURLToPath(
          new URL('./node_modules/monaco-themes/themes', import.meta.url),
        ),
      },
    },
  },
  // Flat-config ESLint (ESLint 9). Stylistic rules off — Prettier owns formatting.
  eslint: {
    config: { stylistic: false },
    checker: false,
  },
  // Components are exclusively `.vue`; co-located `.ts` files (types/data/
  // controllers, plus shadcn-vue `ui/<x>/index.ts` barrels) must stay out of the
  // auto-scan or two `types.ts` both resolve to `<Types>` (name collision).
  components: [{ path: '~/components', pathPrefix: false, ignore: ['**/*.ts'] }],
  // Tailwind base/components/utilities come from main.css (module prepends it),
  // then the ported prototype design system, then app-shell overrides last so
  // the full-window shell wins over the prototype's centered-showcase framing.
  tailwindcss: { cssPath: '~/assets/css/main.css' },
  css: [
    // Bundled variable fonts (offline, local-first) for the Appearance → Font
    // picker. 'Geist Variable' / 'Geist Mono Variable' become available; the
    // System option falls back to the OS sans stack.
    '@fontsource-variable/geist',
    '@fontsource-variable/geist-mono',
    '~/assets/css/prototype.css',
    '~/assets/css/app-shell.css',
    '@vue-flow/core/dist/style.css',
    '@vue-flow/core/dist/theme-default.css',
    '@vue-flow/controls/dist/style.css',
    '@vue-flow/minimap/dist/style.css',
    // KaTeX styles for LaTeX math in markdown (useMarkdown). We import a GENERATED
    // copy with every font inlined as a data: URI (scripts/inline-katex-fonts.mjs)
    // instead of the vendor katex.min.css: in dev Vite rewrites the vendor CSS's
    // url(fonts/*.woff2) to absolute dev-origin URLs that 404/ERR_CONNECTION_REFUSED
    // from the tray-popover window or after a dev-server restart. Inlined = zero
    // network fetch, so math renders under dev, `nuxt build`, and app://.
    '~/assets/css/katex.css',
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
