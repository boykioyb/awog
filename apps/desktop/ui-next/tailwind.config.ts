import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

// ui-next theming is driven by the ported prototype design system (CSS custom
// properties on :root / body.light in assets/css/prototype.css), not Tailwind
// color tokens. Tailwind here only provides layout/spacing/typography utilities.
//
// shadcn-vue layer: named utilities map onto the STANDARD shadcn var names
// (--background/--foreground/--primary/…). Whoever owns the theme supplies the
// values — for the /proto preview that is assets/css/proto-shadcn.css (real
// neutral-theme oklch); a production bridge would alias them onto AWOG tokens.
//
// `c()` uses relative-color syntax so `/alpha` modifiers (`bg-primary/90`) keep
// working with any var format (oklch/hsl/rgb). Tokens that may already carry
// alpha (--border/--input in dark) are mapped bare — wrapping them would strip
// their built-in alpha (verified in the prototype).
const c = (v: string) => `rgb(from var(${v}) r g b / <alpha-value>)`
const raw = (v: string) => `var(${v})`

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
      colors: {
        background: c('--background'),
        foreground: c('--foreground'),
        card: { DEFAULT: c('--card'), foreground: c('--card-foreground') },
        popover: { DEFAULT: c('--popover'), foreground: c('--popover-foreground') },
        primary: { DEFAULT: c('--primary'), foreground: c('--primary-foreground') },
        secondary: { DEFAULT: c('--secondary'), foreground: c('--secondary-foreground') },
        muted: { DEFAULT: c('--muted'), foreground: c('--muted-foreground') },
        // `--accent` is AWOG's emerald brand color, NOT shadcn's neutral hover-wash —
        // the wash lives on the dedicated --accent-wash var (bridge + proto both define it).
        accent: { DEFAULT: c('--accent-wash'), foreground: c('--accent-foreground') },
        destructive: {
          DEFAULT: c('--destructive'),
          foreground: c('--destructive-foreground'),
        },
        // AWOG text steps beyond muted-foreground (text-dim / text-faint).
        dim: c('--textDim'),
        faint: c('--textFaint'),
        border: raw('--border'),
        input: raw('--input'),
        ring: raw('--ring'),
        sidebar: {
          DEFAULT: c('--sidebar'),
          foreground: c('--sidebar-foreground'),
          primary: c('--sidebar-primary'),
          'primary-foreground': c('--sidebar-primary-foreground'),
          accent: c('--sidebar-accent'),
          'accent-foreground': c('--sidebar-accent-foreground'),
          border: raw('--sidebar-border'),
          ring: c('--sidebar-ring'),
        },
        // Status hues beyond the neutral palette (session/task states).
        success: c('--success'),
        warning: c('--warning'),
        info: c('--info'),
      },
      // Font utilities resolve to the AWOG stacks — Appearance → Font family/size
      // keeps working (Geist/Inter/system opt-in, --font-size-base rem scaling).
      fontFamily: { sans: 'var(--sans)', mono: 'var(--code)' },
      // text-* aliases onto the --fs-*/--lh-* scale so utilities follow
      // Appearance → Font size instead of Tailwind's fixed rem steps. Unlisted
      // steps (3xl+) keep Tailwind defaults — nothing uses them.
      fontSize: {
        xs: ['var(--fs-xs)', 'var(--lh-xs)'],
        sm: ['var(--fs-sm)', 'var(--lh-sm)'],
        base: ['var(--fs-md)', 'var(--lh-md)'],
        lg: ['var(--fs-lg)', 'var(--lh-lg)'],
        xl: ['var(--fs-xl)', 'var(--lh-xl)'],
        '2xl': ['var(--fs-2xl)', 'var(--lh-2xl)'],
      },
      // shadcn radius convention: one --radius, derived steps.
      borderRadius: {
        sm: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
      },
    },
  },
  plugins: [animate],
}
