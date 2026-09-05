import type {
  AppearanceExtras,
  FontWeight,
  SansFamily,
  SurfaceDepth,
  ThemeFamily,
} from '~/stores/settings'

// Applies the settings-store appearance slice to the DOM (CSS vars + body
// attributes the prototype CSS / app-shell.css consume). Shared so it runs both
// at app boot (app.vue, so a reload paints saved prefs) and live from the
// Appearance settings panel. Client-only (SPA); callers invoke from onMounted.
//
// - sans family  → `--sans`            (prototype `html,body{font-family:var(--sans)}`)
// - font weight  → `--font-weight-base` (app-shell `body{font-weight:var(--font-weight-base)}`)
// - surface depth→ `body[data-surface]` (app-shell layer-token overrides)
// - theme family → `body[data-theme-family]`
// - liquid glass → `body.glass`
// - code wrap    → `body[data-code-wrap]` (app-shell `.codeblock pre` soft-wrap)
//
// `applyReducedMotion` lives here too but is NOT part of AppearanceExtras: it
// reads settings.sessions.reducedMotion (a separate store slice). It toggles
// `<html data-reduced-motion="1">`, which app-shell.css uses to force-disable all
// animations/transitions regardless of the OS prefers-reduced-motion setting.
const SANS_STACKS: Record<SansFamily, string> = {
  geist: "'Geist Variable', system-ui, sans-serif",
  inter: "'Inter', system-ui, sans-serif",
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
}

export function useAppearanceDom() {
  const applySansFamily = (value: SansFamily) =>
    document.documentElement.style.setProperty('--sans', SANS_STACKS[value])
  const applyFontWeight = (value: FontWeight) =>
    document.documentElement.style.setProperty('--font-weight-base', String(value))
  const applySurfaceDepth = (value: SurfaceDepth) => {
    document.body.dataset.surface = value
  }
  const applyThemeFamily = (value: ThemeFamily) => {
    document.body.dataset.themeFamily = value
  }
  const applyGlass = (value: boolean) => document.body.classList.toggle('glass', value)
  // Soft-wrap in rendered-markdown code blocks. An attribute (not a class) so the CSS reads
  // as a stated preference, and so a future third mode has somewhere to go.
  const applyCodeWrap = (value: boolean) => {
    document.body.dataset.codeWrap = value ? 'on' : 'off'
  }
  const applyReducedMotion = (value: boolean) => {
    if (value) document.documentElement.dataset.reducedMotion = '1'
    else delete document.documentElement.dataset.reducedMotion
  }

  const applyAll = (a: AppearanceExtras) => {
    applySansFamily(a.sansFamily)
    applyFontWeight(a.fontWeight)
    applySurfaceDepth(a.surfaceDepth)
    applyThemeFamily(a.themeFamily)
    applyGlass(a.liquidGlass)
    applyCodeWrap(a.codeWrap)
  }

  return {
    applySansFamily,
    applyFontWeight,
    applySurfaceDepth,
    applyThemeFamily,
    applyGlass,
    applyCodeWrap,
    applyReducedMotion,
    applyAll,
  }
}
