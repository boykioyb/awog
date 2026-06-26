import { ref } from 'vue'

// Dark/light + accent, driven by the ported prototype design system. Theme tokens
// live on `:root` (dark, default) and `body.light` (light); switching = toggling
// the `light` class on <body>. Accent overrides the `--accent*` CSS vars inline on
// <body> (inline wins over both :root and body.light, so the chosen accent holds in
// either theme). Module-level refs so every consumer shares one source.
const STORAGE_THEME = 'awog-theme'
const STORAGE_ACCENT = 'awog-accent'
const STORAGE_FONT = 'awog-font-size'
const isDark = ref(true)
const accent = ref('#10b981')
// True once the user picks a custom accent (or one was restored from storage). Only
// then do we pin --accent* inline; otherwise we let the prototype's per-theme CSS
// defaults stand (light uses a darker #059669, not the dark-mode #10b981).
const accentOverridden = ref(false)
const fontSize = ref(13)

function applyTheme() {
  document.body.classList.toggle('light', !isDark.value)
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const n = parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

// Set --accent + derived tokens on <body>. accentText is the foreground for filled
// accent controls (.btn.pri, .iconbtn.pri, .btn.pri.stop, logo, .fbadge…) and is
// picked for readable contrast via relative luminance; dim/border mirror the
// prototype's low-alpha accent washes.
//
// The threshold is theme-aware. In light mode the page is white, so saturated
// accents (blue #60a5fa ~0.61, cyan #22d3ee ~0.69, amber ~0.65) must keep WHITE
// text/icons — a high threshold (0.85) means only a near-white accent (#fafafa)
// flips to dark text. This matches the prototype's `body.light --accentText:#fff`
// and avoids dark text on a colored fill. In dark mode bright accents read better
// with dark text, so the original 0.6 threshold stands.
function applyAccent() {
  const { r, g, b } = hexToRgb(accent.value)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const threshold = isDark.value ? 0.6 : 0.85
  const s = document.body.style
  s.setProperty('--accent', accent.value)
  s.setProperty('--accentText', luminance > threshold ? '#0a0a0a' : '#ffffff')
  s.setProperty('--accentDim', `rgba(${r}, ${g}, ${b}, 0.14)`)
  s.setProperty('--accentBorder', `rgba(${r}, ${g}, ${b}, 0.42)`)
}

// Set the base font size (px) on <html>. All prototype font-sizes are rem, so
// this scales the whole UI proportionally.
function applyFontSize() {
  document.documentElement.style.setProperty('--font-size-base', `${fontSize.value}px`)
}

export function useTheme() {
  // Read persisted choices and paint. Call once on app mount (client-only SPA).
  function init() {
    const savedTheme = localStorage.getItem(STORAGE_THEME)
    if (savedTheme === 'light' || savedTheme === 'dark') isDark.value = savedTheme === 'dark'
    applyTheme()
    // Only override the per-theme default accent once the user has chosen one,
    // so a fresh install keeps the prototype's dark/light accent defaults.
    const savedAccent = localStorage.getItem(STORAGE_ACCENT)
    if (savedAccent && /^#[0-9a-fA-F]{3,8}$/.test(savedAccent)) {
      accent.value = savedAccent
      accentOverridden.value = true
      applyAccent()
    }
    const savedFont = Number(localStorage.getItem(STORAGE_FONT))
    if (savedFont >= 12 && savedFont <= 18) {
      fontSize.value = savedFont
      applyFontSize()
    }
  }

  function toggleTheme() {
    isDark.value = !isDark.value
    localStorage.setItem(STORAGE_THEME, isDark.value ? 'dark' : 'light')
    applyTheme()
    // --accentText's contrast threshold is theme-aware, so re-derive it for the new
    // mode — but only when a custom accent is pinned inline; otherwise the per-theme
    // CSS defaults already handle it.
    if (accentOverridden.value) applyAccent()
  }

  function setAccent(hex: string) {
    accent.value = hex
    accentOverridden.value = true
    localStorage.setItem(STORAGE_ACCENT, hex)
    applyAccent()
  }

  function setFontSize(px: number) {
    fontSize.value = Math.max(12, Math.min(18, px))
    localStorage.setItem(STORAGE_FONT, String(fontSize.value))
    applyFontSize()
  }

  return { isDark, accent, fontSize, init, toggleTheme, setAccent, setFontSize }
}
