import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

// ui-next theming is driven by the ported prototype design system (CSS custom
// properties on :root / body.light in assets/css/prototype.css), not Tailwind
// color tokens. Tailwind here only provides layout/spacing/typography utilities.
// (When shadcn-vue primitives are introduced, re-add the `--awog-*` token bridge.)
export default <Partial<Config>>{
  content: [
    './components/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './app.vue',
    './composables/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [animate],
}
