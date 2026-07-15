import { ref } from 'vue'

// ── Editable global keymap (§9 globals) ──────────────────────────────────────
// A module-level singleton so the global key handler (useGlobalShortcuts) and the
// Settings editor (SettingsKeymap) share one source of truth. Bindings persist to
// localStorage (renderer-only concern — the shortcuts are consumed entirely in the
// renderer; no IPC needed). Each action maps to a Combo; matching uses `event.code`
// so it is layout-independent and unaffected by Shift.

export type KeymapActionId =
  | 'commandPalette'
  | 'toggleTerminal'
  | 'openGit'
  | 'openPrSummary'
  | 'newSession'
  | 'toggleFiles'

// A key combo. `mod` is the platform primary modifier — ⌘ on macOS, Ctrl elsewhere
// — so a default binding is portable. `ctrl`/`meta` are the explicit secondary
// modifiers (e.g. an explicit ⌃ on macOS). `code` is a KeyboardEvent.code.
export type Combo = {
  mod?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
  code: string
}

export type KeymapAction = { id: KeymapActionId; labelKey: string; default: Combo }

// The rebindable actions + their factory defaults. Order = display order.
export const KEYMAP_ACTIONS: readonly KeymapAction[] = [
  {
    id: 'commandPalette',
    labelKey: 'settings.keymap.act.commandPalette',
    default: { mod: true, code: 'KeyK' },
  },
  {
    id: 'toggleTerminal',
    labelKey: 'settings.keymap.act.toggleTerminal',
    default: { mod: true, code: 'KeyJ' },
  },
  { id: 'openGit', labelKey: 'settings.keymap.act.openGit', default: { mod: true, code: 'KeyG' } },
  {
    id: 'openPrSummary',
    labelKey: 'settings.keymap.act.openPrSummary',
    default: { mod: true, code: 'KeyI' },
  },
  {
    id: 'newSession',
    labelKey: 'settings.keymap.act.newSession',
    default: { mod: true, code: 'KeyT' },
  },
  {
    id: 'toggleFiles',
    labelKey: 'settings.keymap.act.toggleFiles',
    default: { mod: true, code: 'KeyH' },
  },
] as const

export const isMac =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)

// macOS app-menu accelerators the renderer can never receive (the OS menu consumes
// them first). Blocked as `mod`-only bindings so users can't bind an action to a
// combo that silently won't fire — or, worse, to Quit/Close. ⌘H is intentionally
// absent: its accelerator is stripped from the app menu (see electron main.ts).
const RESERVED_MAC_CODES = new Set(['KeyQ', 'KeyW', 'KeyM'])

const STORAGE_KEY = 'awog-keymap'

type Bindings = Record<KeymapActionId, Combo>

function defaults(): Bindings {
  const out = {} as Bindings
  for (const a of KEYMAP_ACTIONS) out[a.id] = { ...a.default }
  return out
}

// A stored combo is only trusted if it has a string `code` and no unexpected keys.
function isCombo(v: unknown): v is Combo {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return typeof c.code === 'string' && c.code.length > 0
}

function load(): Bindings {
  const base = defaults()
  if (typeof localStorage === 'undefined') return base
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return base
    const rec = parsed as Record<string, unknown>
    for (const a of KEYMAP_ACTIONS) {
      const v = rec[a.id]
      if (isCombo(v)) base[a.id] = sanitize(v)
    }
  } catch {
    // Corrupt payload → fall back to defaults (fail-safe, never throw at boot).
  }
  return base
}

// Keep only the known combo fields (defends against hand-edited localStorage).
function sanitize(c: Combo): Combo {
  const out: Combo = { code: c.code }
  if (c.mod) out.mod = true
  if (c.ctrl) out.ctrl = true
  if (c.alt) out.alt = true
  if (c.shift) out.shift = true
  if (c.meta) out.meta = true
  return out
}

const bindings = ref<Bindings>(load())

function persist(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings.value))
}

// True when the event's modifier state + physical key match the combo.
function matches(e: KeyboardEvent, c: Combo): boolean {
  let needMeta = false
  let needCtrl = false
  if (isMac) {
    needMeta = !!c.mod || !!c.meta
    needCtrl = !!c.ctrl
  } else {
    needCtrl = !!c.mod || !!c.ctrl
    needMeta = !!c.meta
  }
  return (
    e.code === c.code &&
    e.metaKey === needMeta &&
    e.ctrlKey === needCtrl &&
    e.altKey === !!c.alt &&
    e.shiftKey === !!c.shift
  )
}

function combosEqual(a: Combo, b: Combo): boolean {
  return (
    a.code === b.code &&
    !!a.mod === !!b.mod &&
    !!a.ctrl === !!b.ctrl &&
    !!a.alt === !!b.alt &&
    !!a.shift === !!b.shift &&
    !!a.meta === !!b.meta
  )
}

// A binding must carry a non-Shift modifier — otherwise it would fire while typing.
function isValidCombo(c: Combo): boolean {
  return !!(c.mod || c.ctrl || c.alt || c.meta)
}

// A combo macOS would swallow at the menu layer before the renderer sees it.
function isReserved(c: Combo): boolean {
  return isMac && !!c.mod && !c.ctrl && !c.alt && !c.meta && RESERVED_MAC_CODES.has(c.code)
}

// Build a combo from a recorded keydown. The primary modifier maps to `mod`; a
// secondary hardware modifier (⌃ on macOS, ⊞ on Windows) maps to ctrl/meta.
function comboFromEvent(e: KeyboardEvent): Combo {
  const c: Combo = { code: e.code }
  if (isMac) {
    if (e.metaKey) c.mod = true
    if (e.ctrlKey) c.ctrl = true
  } else {
    if (e.ctrlKey) c.mod = true
    if (e.metaKey) c.meta = true
  }
  if (e.altKey) c.alt = true
  if (e.shiftKey) c.shift = true
  return c
}

// A lone modifier press (waiting for the real key) — ignored while recording.
export function isModifierKey(key: string): boolean {
  return key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'OS'
}

const CODE_LABELS: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'Space',
  Enter: '⏎',
  Tab: 'Tab',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}

function codeLabel(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1] ?? code
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1] ?? code
  if (/^F\d{1,2}$/.test(code)) return code
  return CODE_LABELS[code] ?? code
}

// Human-readable combo, platform-aware: macOS uses stacked symbols (⇧⌘G); other
// platforms use "Ctrl+Shift+G". Modifier order follows the platform convention.
function formatCombo(c: Combo): string {
  if (isMac) {
    let out = ''
    if (c.ctrl) out += '⌃'
    if (c.alt) out += '⌥'
    if (c.shift) out += '⇧'
    if (c.mod || c.meta) out += '⌘'
    return out + codeLabel(c.code)
  }
  const parts: string[] = []
  if (c.mod || c.ctrl) parts.push('Ctrl')
  if (c.meta) parts.push('Win')
  if (c.alt) parts.push('Alt')
  if (c.shift) parts.push('Shift')
  parts.push(codeLabel(c.code))
  return parts.join('+')
}

export function useKeymap() {
  // The action whose binding this event triggers, or null. Ignores lone modifiers.
  function matchEvent(e: KeyboardEvent): KeymapActionId | null {
    if (isModifierKey(e.key)) return null
    for (const a of KEYMAP_ACTIONS) {
      if (matches(e, bindings.value[a.id])) return a.id
    }
    return null
  }

  // The action already bound to `combo` (excluding `exceptId`), or null.
  function conflictOf(combo: Combo, exceptId: KeymapActionId): KeymapActionId | null {
    for (const a of KEYMAP_ACTIONS) {
      if (a.id === exceptId) continue
      if (combosEqual(bindings.value[a.id], combo)) return a.id
    }
    return null
  }

  function setBinding(id: KeymapActionId, combo: Combo): void {
    bindings.value = { ...bindings.value, [id]: sanitize(combo) }
    persist()
  }
  function resetBinding(id: KeymapActionId): void {
    const def = KEYMAP_ACTIONS.find((a) => a.id === id)?.default
    if (def) setBinding(id, def)
  }
  function resetAll(): void {
    bindings.value = defaults()
    persist()
  }
  function isDefault(id: KeymapActionId): boolean {
    const def = KEYMAP_ACTIONS.find((a) => a.id === id)?.default
    return !!def && combosEqual(bindings.value[id], def)
  }

  return {
    bindings,
    matchEvent,
    conflictOf,
    setBinding,
    resetBinding,
    resetAll,
    isDefault,
    comboFromEvent,
    isValidCombo,
    isReserved,
    formatCombo,
  }
}
