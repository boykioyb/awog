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
    // `mermaid` cũng chỉ dynamic-import: lần render diagram đầu tiên kích Vite
    // discover dep mới → re-optimize → hash `?v=` của MỌI dep đổi → các chunk
    // monaco đã cache với hash cũ 404 ("Failed to fetch dynamically imported
    // module"). Pre-bundle cả hai để hash ổn định suốt session.
    // `noDiscovery` đóng băng hoàn toàn tập dep ngay từ cold start: Vite chỉ
    // bundle đúng `include`, không crawl/discover thêm giữa session → hash `?v=`
    // không bao giờ drift → không còn cửa sổ re-optimize (504 + lỗi transform
    // trên chunk dep nhiều-MB). `include` phải liệt kê ĐỦ mọi dep cần bundle —
    // dep thiếu sẽ được serve raw ESM (CJS dep sẽ lỗi import ngay). Danh sách
    // này mirror đúng `optimized` mà crawler tìm được ở boot trước.
    optimizeDeps: {
      noDiscovery: true,
      // `monaco-editor` PHẢI nằm ngoài dep-optimizer: esbuild gom nó thành một
      // chunk core ~7.3MB, mà dep request đi qua transform pipeline của Nuxt —
      // một transform handler nổ "Maximum call stack size exceeded" trên file cỡ
      // này → dep fetch 404 sau ~3s → import('monaco-editor') văng "Failed to
      // fetch dynamically imported module". App load monaco qua bundle tĩnh
      // `public/vendor/monaco/monaco.js` (scripts/prebundle-monaco.mjs); giữ
      // exclude phòng trường hợp code nào lại bare-import gói này — sẽ đi đường
      // raw-ESM (chậm nhưng đúng) chứ không vào dep path crash.
      exclude: ['monaco-editor'],
      include: [
        'mermaid',
        // `errx` là transitive dep pure-ESM của nuxt — không resolve được từ
        // đây qua pnpm nên không include được, serve raw vẫn đúng.
        'pinia',
        'lucide-vue-next',
        'reka-ui',
        'class-variance-authority',
        'clsx',
        'tailwind-merge',
        'katex',
        'marked',
        'marked-katex-extension',
        'shiki',
        '@xterm/addon-fit',
        '@xterm/xterm',
        '@xterm/addon-webgl',
        '@vue-flow/background',
        '@vue-flow/controls',
        '@vue-flow/core',
        'qrcode',
      ],
    },
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
    // shadcn neutral theme for the /proto preview — scoped to body.proto-shadcn,
    // inert for the rest of the app. See the file header for the bridge story.
    '~/assets/css/proto-shadcn.css',
    // shadcn canonical var names → AWOG token aliases (production bridge, :root).
    // Lets components/ui/* consume the standard shadcn names app-wide while the
    // look stays AWOG; light/cute flip for free through the aliased vars.
    '~/assets/css/shadcn-bridge.css',
    // Rendered-markdown prose (`.mdbody`) — global so every surface that renders
    // markdown gets the same typography instead of each component carrying its own
    // scoped copy (ADR 0073).
    '~/assets/css/markdown.css',
    // Agent whitelist pickers (`.awp-*`) — shared by AgentEditor and the agent
    // detail tabs so both surfaces render the same checkbox/chip lists.
    '~/assets/css/agent-whitelist.css',
    // The "Cute" theme family (Settings → Appearance → Theme). Every rule inside is
    // scoped under `body[data-theme-family='cute']`, so it is inert unless the user
    // opts in; loaded last so it wins over both the prototype design system and the
    // app-shell overrides. See docs/features/theme-cute.md.
    '~/assets/css/theme-cute.css',
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
