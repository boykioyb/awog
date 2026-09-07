import { computed } from 'vue'
import { useSettingsStore } from '~/stores/settings'

// ── Editable global keymap (§9 globals) ──────────────────────────────────────
// The global key handler (useGlobalShortcuts) and the Settings editor
// (SettingsKeymap) share one source of truth: the `keymap` slice of the settings
// store, which persists to ~/.awog/settings.json through the sidecar (issue #43).
// This module owns the SCHEMA — the action list, combo validation and formatting —
// while the store only carries the blob to and from disk.
//
// Matching uses `event.code` so it is layout-independent and unaffected by Shift.

export type KeymapActionId =
  | 'commandPalette'
  | 'toggleTerminal'
  | 'openGit'
  | 'openPrSummary'
  | 'newSession'
  | 'toggleFiles'
  | 'toggleDiff'
  | 'togglePlan'
  | 'openSettings'
  | 'nextSession'
  | 'prevSession'
  | 'goSessions'
  | 'goTasks'
  | 'goProjects'

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

// What the settings store persists: action id → combo. Values are typed `unknown`
// because settings.json is hand-editable and may come from another build: every
// entry is validated by `isCombo` on the way in (`fromBlob`), never trusted raw.
export type KeymapBlob = Record<string, unknown>

// Actions are grouped in the editor; the group is display-only.
export type KeymapGroup = 'global' | 'session' | 'navigate'

export type KeymapAction = {
  id: KeymapActionId
  labelKey: string
  group: KeymapGroup
  default: Combo
}

// The rebindable actions + their factory defaults. Order = display order.
// ⌘Q / ⌘W / ⌘M are consumed by the macOS menu (see RESERVED_MAC_CODES); ⌘, is
// free because the app menu ships no Preferences item (electron/src/main.ts).
export const KEYMAP_ACTIONS: readonly KeymapAction[] = [
  {
    id: 'commandPalette',
    labelKey: 'settings.keymap.act.commandPalette',
    group: 'global',
    default: { mod: true, code: 'KeyK' },
  },
  {
    id: 'toggleTerminal',
    labelKey: 'settings.keymap.act.toggleTerminal',
    group: 'global',
    default: { mod: true, code: 'KeyJ' },
  },
  {
    id: 'openGit',
    labelKey: 'settings.keymap.act.openGit',
    group: 'global',
    default: { mod: true, code: 'KeyG' },
  },
  {
    id: 'openPrSummary',
    labelKey: 'settings.keymap.act.openPrSummary',
    group: 'global',
    default: { mod: true, code: 'KeyI' },
  },
  {
    id: 'openSettings',
    labelKey: 'settingsKeymap.act.openSettings',
    group: 'global',
    default: { mod: true, code: 'Comma' },
  },
  {
    id: 'newSession',
    labelKey: 'settings.keymap.act.newSession',
    group: 'session',
    default: { mod: true, code: 'KeyT' },
  },
  {
    id: 'toggleFiles',
    labelKey: 'settings.keymap.act.toggleFiles',
    group: 'session',
    default: { mod: true, code: 'KeyH' },
  },
  {
    id: 'toggleDiff',
    labelKey: 'settingsKeymap.act.toggleDiff',
    group: 'session',
    default: { mod: true, shift: true, code: 'KeyD' },
  },
  {
    id: 'togglePlan',
    labelKey: 'settingsKeymap.act.togglePlan',
    group: 'session',
    default: { mod: true, shift: true, code: 'KeyP' },
  },
  {
    id: 'nextSession',
    labelKey: 'settingsKeymap.act.nextSession',
    group: 'navigate',
    default: { mod: true, alt: true, code: 'ArrowDown' },
  },
  {
    id: 'prevSession',
    labelKey: 'settingsKeymap.act.prevSession',
    group: 'navigate',
    default: { mod: true, alt: true, code: 'ArrowUp' },
  },
  {
    id: 'goSessions',
    labelKey: 'settingsKeymap.act.goSessions',
    group: 'navigate',
    default: { mod: true, code: 'Digit1' },
  },
  {
    id: 'goTasks',
    labelKey: 'settingsKeymap.act.goTasks',
    group: 'navigate',
    default: { mod: true, code: 'Digit2' },
  },
  {
    id: 'goProjects',
    labelKey: 'settingsKeymap.act.goProjects',
    group: 'navigate',
    default: { mod: true, code: 'Digit3' },
  },
] as const

// Display order of the groups in the editor.
export const KEYMAP_GROUPS: readonly KeymapGroup[] = ['global', 'session', 'navigate']

export const isMac =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)

// macOS app-menu accelerators the renderer can never receive (the OS menu consumes
// them first). Blocked as `mod`-only bindings so users can't bind an action to a
// combo that silently won't fire — or, worse, to Quit/Close. ⌘H is intentionally
// absent: its accelerator is stripped from the app menu (see electron main.ts).
const RESERVED_MAC_CODES = new Set(['KeyQ', 'KeyW', 'KeyM'])

// Pre-#43 home of the bindings. Read ONCE to seed the settings store, then left
// alone: nothing is deleted, so rolling back to an older build still finds it.
const LEGACY_STORAGE_KEY = 'awog-keymap'

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

// Keep only the known combo fields (defends against a hand-edited settings.json).
function sanitize(c: Combo): Combo {
  const out: Combo = { code: c.code }
  if (c.mod) out.mod = true
  if (c.ctrl) out.ctrl = true
  if (c.alt) out.alt = true
  if (c.shift) out.shift = true
  if (c.meta) out.meta = true
  return out
}

// Resolve a persisted blob into a full binding set: unknown ids are dropped, ids
// the blob does not mention keep their factory default.
function fromBlob(blob: KeymapBlob): Bindings {
  const base = defaults()
  for (const a of KEYMAP_ACTIONS) {
    const v: unknown = blob[a.id]
    if (isCombo(v)) base[a.id] = sanitize(v)
  }
  return base
}

// One-way migration of the localStorage bindings into settings.json. Runs at most
// once per app session, and only while the store slice is still empty — once the
// store has bindings (from disk or from this migration) it is the only truth.
let migrated = false

function migrateLegacy(current: KeymapBlob): KeymapBlob | null {
  if (migrated) return null
  migrated = true
  if (Object.keys(current).length > 0) return null
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const rec = parsed as Record<string, unknown>
    const out: KeymapBlob = {}
    for (const a of KEYMAP_ACTIONS) {
      const v = rec[a.id]
      if (isCombo(v)) out[a.id] = sanitize(v)
    }
    if (Object.keys(out).length === 0) return null
    console.warn('[keymap] migrating bindings from localStorage → settings.json')
    return out
  } catch {
    // Corrupt payload → defaults (fail-safe, never throw at boot).
    return null
  }
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
  const settings = useSettingsStore()
  const seed = migrateLegacy(settings.keymap)
  if (seed) settings.setKeymap(seed)

  // Derived from the persisted blob, so every consumer reacts the moment a binding
  // is written (and when settings.json hydration lands after boot).
  const bindings = computed<Bindings>(() => fromBlob(settings.keymap))

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
    settings.setKeymap({ ...settings.keymap, [id]: sanitize(combo) })
  }
  function resetBinding(id: KeymapActionId): void {
    const next = { ...settings.keymap }
    delete next[id]
    settings.setKeymap(next)
  }
  // An empty blob IS "everything at its default" — storing the defaults verbatim
  // would freeze this build's choices against a future change of default.
  function resetAll(): void {
    settings.setKeymap({})
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
