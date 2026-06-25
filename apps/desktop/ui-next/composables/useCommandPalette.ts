import type { Component } from 'vue'
import { computed, ref } from 'vue'

// ── ⌘K command palette (§9 globals) ─────────────────────────────────────────
// A module-level singleton so any component can open/close the palette and the
// global key handler (mounted once in the layout) shares one source of truth.
// Self-contained: no external fuzzy lib, no store coupling beyond the command
// closures the palette consumer wires up.

// One palette command: a navigate / action row. `run` is the closure executed on
// Enter / click; the palette closes itself afterwards. `section` groups rows.
export type PaletteCommand = {
  id: string
  label: string
  hint?: string
  icon?: Component
  section: 'navigate' | 'session'
  run: () => void
}

// A scored, ordered command ready to render. `positions` are the matched-char
// indices in `label` for highlight.
export type PaletteEntry = PaletteCommand & { positions: number[] }

// ── Fuzzy matcher ────────────────────────────────────────────────────────────
// Subsequence match (chars of the query appear in order). Scores contiguous runs
// and word-boundary hits higher so "gs" → "Go to Sessions" ranks well. Returns
// null on no match.
type FuzzyResult = { score: number; positions: number[] }

function fuzzy(query: string, target: string): FuzzyResult | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q.length === 0) return { score: 0, positions: [] }

  const positions: number[] = []
  let score = 0
  let ti = 0
  let prevMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    for (; ti < t.length; ti++) {
      if (t[ti] === ch) {
        found = ti
        break
      }
    }
    if (found === -1) return null
    positions.push(found)
    // Contiguous run bonus + word-boundary bonus (start or after a separator).
    if (found === prevMatch + 1) score += 5
    const prevCh = found > 0 ? t[found - 1] : ' '
    if (prevCh === ' ' || prevCh === '/' || prevCh === '-' || prevCh === '_') score += 8
    prevMatch = found
    ti = found + 1
  }
  // Prefer shorter targets (closer match density).
  score += Math.max(0, 20 - target.length)
  return { score, positions }
}

// Split a label into matched / unmatched segments for highlight rendering.
export type LabelSegment = { text: string; match: boolean }
export function highlightSegments(label: string, positions: number[]): LabelSegment[] {
  if (positions.length === 0) return [{ text: label, match: false }]
  const set = new Set(positions)
  const segs: LabelSegment[] = []
  let buf = ''
  let bufMatch = set.has(0)
  for (let i = 0; i < label.length; i++) {
    const ch = label[i] ?? ''
    const m = set.has(i)
    if (m === bufMatch) {
      buf += ch
    } else {
      if (buf) segs.push({ text: buf, match: bufMatch })
      buf = ch
      bufMatch = m
    }
  }
  if (buf) segs.push({ text: buf, match: bufMatch })
  return segs
}

// ── Singleton state ──────────────────────────────────────────────────────────
const isOpen = ref(false)

// Prompt-edit overlay (§9). Holds the text being edited + a resolve callback so a
// caller can `await openPromptEdit(seed)` and receive the edited text (or null on
// cancel). Decoupled from the sessions store so any component can drive it.
type PromptEditState = {
  text: string
  resolve: (next: string | null) => void
} | null
const promptEdit = ref<PromptEditState>(null)

export function useCommandPalette() {
  function open() {
    isOpen.value = true
  }
  function close() {
    isOpen.value = false
  }
  function toggle() {
    isOpen.value = !isOpen.value
  }

  // Open the prompt-edit overlay seeded with `text`; resolves with the edited
  // string on confirm or null on cancel. Awaiting callers wire the result to
  // their resend / seedComposer flow.
  function openPromptEdit(text: string): Promise<string | null> {
    // Resolve any overlay still open (defensive — should be rare).
    promptEdit.value?.resolve(null)
    return new Promise<string | null>((resolve) => {
      promptEdit.value = { text, resolve }
    })
  }
  function confirmPromptEdit(next: string) {
    promptEdit.value?.resolve(next)
    promptEdit.value = null
  }
  function cancelPromptEdit() {
    promptEdit.value?.resolve(null)
    promptEdit.value = null
  }

  return {
    isOpen: computed(() => isOpen.value),
    open,
    close,
    toggle,
    promptEdit: computed(() => promptEdit.value),
    openPromptEdit,
    confirmPromptEdit,
    cancelPromptEdit,
  }
}

// Rank a command set against a query. Empty query keeps source order (grouped by
// section in the consumer). Exposed standalone so the .vue stays a thin view.
export function rankCommands(query: string, commands: PaletteCommand[]): PaletteEntry[] {
  const q = query.trim()
  if (q.length === 0) return commands.map((c) => ({ ...c, positions: [] }))
  const scored: { c: PaletteCommand; r: FuzzyResult }[] = []
  for (const c of commands) {
    const r = fuzzy(q, c.label)
    if (r) scored.push({ c, r })
  }
  scored.sort((a, b) => b.r.score - a.r.score)
  return scored.map(({ c, r }) => ({ ...c, positions: r.positions }))
}
