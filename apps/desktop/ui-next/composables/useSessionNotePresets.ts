// Reusable pinned-context notes — a cross-session library so a note written in one
// session can be re-applied in any other. Two lists, both global (NOT per-session)
// and persisted to localStorage:
//   - presets : notes the user intentionally KEEPS (saved via "Save as preset");
//               never evicted, deleted explicitly.
//   - history : notes auto-captured as they're committed; deduped, capped, most-recent
//               first — a quick "use that thing I wrote earlier" affordance.
// Module-level singleton: every SessionComposer in this renderer shares one source of
// truth. UX-only convenience data (plain text), so localStorage is the right home —
// no sidecar/IPC round-trip (mirrors useGitBranchPins).
import { computed, ref } from 'vue'

const PRESETS_KEY = 'awog.session.notePresets'
const HISTORY_KEY = 'awog.session.noteHistory'
const HISTORY_MAX = 8

export type NotePreset = { id: string; name: string; text: string }

function loadPresets(): NotePreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) return []
    // Re-validate at the boundary (L2): localStorage is user-editable.
    return parsed.filter(
      (p): p is NotePreset =>
        !!p &&
        typeof p === 'object' &&
        typeof (p as NotePreset).id === 'string' &&
        typeof (p as NotePreset).name === 'string' &&
        typeof (p as NotePreset).text === 'string',
    )
  } catch {
    return []
  }
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((h): h is string => typeof h === 'string').slice(0, HISTORY_MAX)
  } catch {
    return []
  }
}

// Shared across all callers in this renderer.
const presets = ref<NotePreset[]>(loadPresets())
const history = ref<string[]>(loadHistory())

function persistPresets(): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.value))
  } catch {
    // localStorage unavailable (private mode / quota) — presets just won't persist.
  }
}
function persistHistory(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
  } catch {
    // localStorage unavailable — history just won't persist.
  }
}

// Short label for a note: its first non-empty line, trimmed to fit a popover row.
function deriveName(text: string): string {
  const first =
    text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  if (!first) return 'Note'
  return first.length > 48 ? `${first.slice(0, 48)}…` : first
}

let idSeq = 0
function newId(): string {
  idSeq += 1
  return `np-${Date.now().toString(36)}-${idSeq.toString(36)}`
}

export function useSessionNotePresets() {
  // Save the current note text as a kept preset. Dedupe by exact text so repeated
  // saves of the same note don't pile up. Most-recent first.
  const savePreset = (text: string, name?: string): void => {
    const t = text.trim()
    if (!t || presets.value.some((p) => p.text === t)) return
    presets.value = [
      { id: newId(), name: name?.trim() || deriveName(t), text: t },
      ...presets.value,
    ]
    persistPresets()
  }

  const deletePreset = (id: string): void => {
    presets.value = presets.value.filter((p) => p.id !== id)
    persistPresets()
  }

  // Record a note into recent history (deduped → most-recent first, capped).
  const recordHistory = (text: string): void => {
    const t = text.trim()
    if (!t) return
    history.value = [t, ...history.value.filter((h) => h !== t)].slice(0, HISTORY_MAX)
    persistHistory()
  }

  // Remove a single note from recent history (dedup key is exact text).
  const deleteHistory = (text: string): void => {
    history.value = history.value.filter((h) => h !== text)
    persistHistory()
  }

  const clearHistory = (): void => {
    history.value = []
    persistHistory()
  }

  return {
    presets: computed(() => presets.value),
    history: computed(() => history.value),
    savePreset,
    deletePreset,
    recordHistory,
    deleteHistory,
    clearHistory,
    deriveName,
  }
}
