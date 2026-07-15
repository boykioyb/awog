import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

// Terminal appearance store — a per-machine UI preference for how the xterm
// terminals look (color theme + font size + font family). Renderer-only: this is
// a cosmetic choice with no secret material and no engine relevance, so it
// persists to localStorage rather than crossing IPC (mirrors sshSnippets /
// useProjectColors' renderer-local pattern).
//
// #1 invariant — zero change by default. The default preset is 'system'
// (theme: null) → the shared WorkspaceTerminal keeps deriving its palette from
// the app's CSS theme tokens exactly as it does today, and the default fontSize
// (13) + mono stack match the current inline literals. Until the user picks a
// different preset / size / font, every terminal looks byte-identical to now.

// The xterm ITheme subset we let a preset control (color slots only — layout /
// blink / cursor style stay on WorkspaceTerminal). Concrete hex lives in the
// PRESETS table below: that is palette DATA, not component styling, so the
// "no hardcoded hex" rule (which governs component <style>) does not apply here.
export type XtermTheme = {
  background: string
  foreground: string
  cursor: string
  cursorAccent?: string
  selectionBackground: string
  selectionForeground?: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightWhite: string
}

export type TerminalPreset = {
  id: string
  name: string
  // null → "use the app's CSS-var theme" (the default 'system' preset). The
  // consumer (WorkspaceTerminal.resolveTheme) reads the live tokens in that case.
  theme: XtermTheme | null
}

// The default preset — the app's CSS-var theme (no override). Named so it can be
// the guaranteed fallback for the `preset` getter (readonly index access is
// `T | undefined` under noUncheckedIndexedAccess).
export const SYSTEM_PRESET: TerminalPreset = { id: 'system', name: 'System', theme: null }

// The selectable presets. 'system' is first + default (theme: null). The rest
// carry concrete, well-known palettes.
export const PRESETS: readonly TerminalPreset[] = [
  SYSTEM_PRESET,
  {
    id: 'dark',
    name: 'Dark',
    theme: {
      background: '#1c1c1e',
      foreground: '#e5e5e5',
      cursor: '#e5e5e5',
      cursorAccent: '#1c1c1e',
      selectionBackground: '#3a3a3c',
      selectionForeground: '#ffffff',
      black: '#1c1c1e',
      red: '#ff6b6b',
      green: '#4ec9b0',
      yellow: '#dcdcaa',
      blue: '#569cd6',
      magenta: '#c586c0',
      cyan: '#4dd0e1',
      white: '#e5e5e5',
      brightBlack: '#6b6b6f',
      brightRed: '#ff8787',
      brightGreen: '#73c991',
      brightYellow: '#f0e68c',
      brightBlue: '#7cb7ff',
      brightMagenta: '#d7a3d7',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    theme: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      cursorAccent: '#002b36',
      selectionBackground: '#073642',
      selectionForeground: '#93a1a1',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightWhite: '#fdf6e3',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    theme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: '#44475a',
      selectionForeground: '#f8f8f2',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'light',
    name: 'Light',
    theme: {
      background: '#ffffff',
      foreground: '#1f2328',
      cursor: '#1f2328',
      cursorAccent: '#ffffff',
      selectionBackground: '#b3d7ff',
      selectionForeground: '#1f2328',
      black: '#24292e',
      red: '#d73a49',
      green: '#28a745',
      yellow: '#b08800',
      blue: '#0366d6',
      magenta: '#6f42c1',
      cyan: '#1b7c83',
      white: '#6a737d',
      brightBlack: '#959da5',
      brightRed: '#cb2431',
      brightGreen: '#22863a',
      brightYellow: '#b08800',
      brightBlue: '#005cc5',
      brightMagenta: '#5a32a3',
      brightWhite: '#24292e',
    },
  },
]

export type FontOption = { label: string; value: string }

// Font stacks offered in the picker. Each ends in a generic `monospace` fallback
// so an uninstalled family degrades gracefully. The first value MUST equal the
// current WorkspaceTerminal literal so 'System mono' is the byte-identical default.
export const DEFAULT_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, monospace'
export const FONT_OPTIONS: readonly FontOption[] = [
  { label: 'System mono', value: DEFAULT_FONT_FAMILY },
  { label: 'Menlo', value: 'Menlo, monospace' },
  { label: 'Monaco', value: 'Monaco, monospace' },
  { label: 'JetBrains Mono', value: 'JetBrains Mono, monospace' },
  { label: 'Fira Code', value: 'Fira Code, monospace' },
  { label: 'Cascadia Code', value: 'Cascadia Code, monospace' },
]

export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 20
export const DEFAULT_FONT_SIZE = 13
const DEFAULT_PRESET_ID = 'system'

const STORAGE_KEY = 'awog-terminal-appearance'

const clampSize = (n: number): number =>
  Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)))

type Persisted = {
  presetId: string
  fontSize: number
  fontFamily: string
}

// Read + validate the persisted preference at the trust boundary (localStorage is
// L1 — a corrupt / hand-edited value must never poison the store). Unknown fields
// fall back to their defaults, so a bad value can only degrade to 'system'/13/mono.
function read(): Persisted {
  const fallback: Persisted = {
    presetId: DEFAULT_PRESET_ID,
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
  }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!raw || typeof raw !== 'object') return fallback
    const rec = raw as Record<string, unknown>
    const presetId =
      typeof rec.presetId === 'string' && PRESETS.some((p) => p.id === rec.presetId)
        ? rec.presetId
        : fallback.presetId
    const fontSize = typeof rec.fontSize === 'number' ? clampSize(rec.fontSize) : fallback.fontSize
    const fontFamily =
      typeof rec.fontFamily === 'string' && rec.fontFamily.trim() !== ''
        ? rec.fontFamily
        : fallback.fontFamily
    return { presetId, fontSize, fontFamily }
  } catch {
    return fallback
  }
}

export const useTerminalAppearanceStore = defineStore('terminalAppearance', () => {
  const initial = read()
  const presetId = ref<string>(initial.presetId)
  const fontSize = ref<number>(initial.fontSize)
  const fontFamily = ref<string>(initial.fontFamily)

  // The active preset object (never undefined — falls back to 'system' if the id
  // is somehow stale) and its theme (null → consumer uses the app CSS-var theme).
  const preset = computed<TerminalPreset>(
    () => PRESETS.find((p) => p.id === presetId.value) ?? SYSTEM_PRESET,
  )
  const theme = computed<XtermTheme | null>(() => preset.value.theme)

  // Persist the whole preference on any change. One source of truth for the write.
  watch([presetId, fontSize, fontFamily], () => {
    if (typeof localStorage === 'undefined') return
    const payload: Persisted = {
      presetId: presetId.value,
      fontSize: fontSize.value,
      fontFamily: fontFamily.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  })

  function setPreset(id: string): void {
    if (!PRESETS.some((p) => p.id === id)) return
    presetId.value = id
  }
  function setFontSize(n: number): void {
    fontSize.value = clampSize(n)
  }
  function setFontFamily(f: string): void {
    const next = f.trim()
    if (next !== '') fontFamily.value = next
  }

  return {
    presetId,
    fontSize,
    fontFamily,
    presets: PRESETS,
    preset,
    theme,
    setPreset,
    setFontSize,
    setFontFamily,
  }
})
