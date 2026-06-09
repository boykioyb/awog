import { storeToRefs } from 'pinia'
import { useSettingsStore } from '~/stores/settings'

// Liquid Glass surface factory — the single leverage point for the app-wide glass
// look. Derives translucent frosted surfaces from the live theme tokens
// (`useTheme().t`) and the `appearance.liquidGlass` toggle. When the toggle is OFF
// it returns the original solid styles, so components migrate once and the switch
// flips the whole app from one place (no per-component conditionals).
//
// Usage mirrors `useTheme`: destructure the pieces you need so template refs
// auto-unwrap — `const { panel, overlay, pill } = useGlass()` then
// `:style="panel"` / `:style="pill(active, hovered)"`.
//
// Note: target runtime is Chromium (Electron + dev Chrome) which supports
// `backdrop-filter` unprefixed, so no `-webkit-` alias is needed.

type StyleObj = Record<string, string>

// #rrggbb → rgba() — ambient/tints derive from the live accent so they harmonise
// with the user's theme pick.
const rgba = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '')
  if (h.length < 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const blur = (px: number): string => `blur(${px}px) saturate(140%)`

export const useGlass = () => {
  const { t } = useTheme()
  const { appearance } = storeToRefs(useSettingsStore())
  const on = computed(() => appearance.value.liquidGlass !== false)

  // Faint accent-tinted radial washes over the base bg so translucent surfaces
  // above have depth to refract (Medium intensity = subtle).
  const appBackground = computed<string>(() => {
    if (!on.value) return t.value.bg
    return [
      `radial-gradient(115% 90% at 100% 0%, ${rgba(t.value.accent, 0.05)}, transparent 55%)`,
      `radial-gradient(100% 90% at 0% 100%, ${rgba(t.value.accentMuted, 0.06)}, transparent 50%)`,
      t.value.bg,
    ].join(', ')
  })

  // Sidebars / list panes / large chrome.
  const panel = computed<StyleObj>(() =>
    on.value
      ? {
          background: t.value.glassBg,
          borderColor: t.value.glassBorder,
          backdropFilter: blur(20),
          boxShadow: `inset 0 1px 0 ${t.value.glassHighlight}`,
        }
      : {
          background: t.value.bgPanel,
          borderColor: t.value.border,
          backdropFilter: 'none',
          boxShadow: 'none',
        },
  )

  // Raised cards / nodes / message bubbles.
  const elevated = computed<StyleObj>(() =>
    on.value
      ? {
          background: t.value.glassBg,
          borderColor: t.value.glassBorder,
          backdropFilter: blur(18),
          boxShadow: `inset 0 1px 0 ${t.value.glassHighlight}, 0 2px 12px -8px ${t.value.shadow}`,
        }
      : {
          background: t.value.bgElevated,
          borderColor: t.value.border,
          backdropFilter: 'none',
          boxShadow: 'none',
        },
  )

  // Modals / docked panels / floating bars — strongest frost, big soft shadow.
  const overlay = computed<StyleObj>(() =>
    on.value
      ? {
          background: t.value.glassBg,
          borderColor: t.value.glassBorder,
          backdropFilter: blur(28),
          boxShadow: `inset 0 1px 0 ${t.value.glassHighlight}, 0 20px 60px ${t.value.shadow}`,
        }
      : {
          background: t.value.bgPanel,
          borderColor: t.value.borderStrong,
          backdropFilter: 'none',
          boxShadow: `0 20px 60px ${t.value.shadow}`,
        },
  )

  // Context menus / popovers.
  const menu = computed<StyleObj>(() =>
    on.value
      ? {
          background: t.value.glassBg,
          borderColor: t.value.glassBorder,
          backdropFilter: blur(24),
          boxShadow: `inset 0 1px 0 ${t.value.glassHighlight}, 0 12px 32px ${t.value.shadow}`,
        }
      : {
          background: t.value.bgPanel,
          borderColor: t.value.borderStrong,
          backdropFilter: 'none',
          boxShadow: `0 12px 32px ${t.value.shadow}`,
        },
  )

  // Inputs stay near-opaque for legibility (Medium); only the border goes glassy.
  const input = computed<StyleObj>(() => ({
    background: t.value.bgInput,
    borderColor: on.value ? t.value.glassBorder : t.value.border,
  }))

  // Composable parts for IN-FLOW chrome with side-specific borders (list-pane
  // border-right, header border-bottom): keep the component's `borderXxx`, plug
  // these in.
  //
  // NO backdrop-filter here. `backdrop-filter` establishes a new stacking context
  // + containing block, which traps non-teleported absolute dropdowns rendered
  // inside the chrome (e.g. the Git project/branch pickers) so they paint BELOW
  // sibling panels. Chrome reads as glass via the translucent `glassBg` tint over
  // the ambient backdrop + hairline border + sheen — over a smooth ambient the
  // blur was near-invisible anyway. Real frost stays on `overlay`/`menu`, which
  // are teleported to <body> (or leaf popovers) and can't trap anything.
  const parts = computed(() => ({
    bg: on.value ? t.value.glassBg : t.value.bgPanel,
    blur: 'none',
    border: on.value ? t.value.glassBorder : t.value.border,
    sheen: on.value ? `inset 0 1px 0 ${t.value.glassHighlight}` : '',
    shadow: t.value.shadow,
  }))

  // Interactive pills (list rows / tabs / filter chips). Tint only — NO
  // backdrop-filter (avoids per-row blur cost and blur stacking). Explicit return
  // shape (not StyleObj) so `.background` is `string`, assignable to DOM styles.
  const pill = (active: boolean, hovered = false): { background: string; borderColor: string } => {
    if (active) {
      return on.value
        ? { background: t.value.glassActive, borderColor: t.value.glassBorder }
        : { background: t.value.bgActive, borderColor: 'transparent' }
    }
    if (hovered) {
      return {
        background: on.value ? t.value.glassHover : t.value.bgHover,
        borderColor: 'transparent',
      }
    }
    return { background: 'transparent', borderColor: 'transparent' }
  }

  return { on, appBackground, panel, elevated, overlay, menu, input, parts, pill }
}
