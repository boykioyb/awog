import { reactive } from 'vue'
import type { PreviewRef } from '~/composables/usePreview'

// Shared, app-wide "minimize dock" (see docs/features/minimize-dock.md). A single
// stack of parked items shown as pills in the bottom-right corner (macOS-screenshot
// metaphor). Minimizing content keeps its context alive so restoring is one click
// away instead of reopening + re-reading from the top.
//
// Module-level reactive array → one source of truth for every caller. Pure data:
// this composable never imports feature stores. MinimizeDock.vue owns restore
// dispatch + live-status derivation (a presentation concern kept in one place).
// In-memory only (renderer) — a reload clears the dock, matching pinned-note presets.

export type MinimizeKind = 'preview' | 'session' | 'task' | 'terminal'

// Discriminated by `kind`. Presentational fields (icon/title) are captured at
// minimize time; session/task pills re-derive live status from their store so the
// pill keeps tracking progress after the source view unmounts.
export type MinimizedEntry =
  | {
      id: string
      kind: 'preview'
      icon: string
      title: string
      ref: PreviewRef
      // View + scroll captured on minimize, replayed on restore (markdown render).
      view: 'render' | 'raw'
      scrollTop: number
    }
  | { id: string; kind: 'session'; icon: string; title: string; sessionId: number }
  | { id: string; kind: 'task'; icon: string; title: string; taskId: string }
  | { id: string; kind: 'terminal'; icon: string; title: string }

// Cap the visible stack; oldest fall off. Keeps the corner from overflowing the
// viewport if a user parks many items.
const MAX_ENTRIES = 6

const entries = reactive<MinimizedEntry[]>([])

export function useMinimizeDock() {
  // Park an item. Re-minimizing the same id moves it to the front (refreshes its
  // snapshot) rather than duplicating.
  function minimize(entry: MinimizedEntry): void {
    const i = entries.findIndex((e) => e.id === entry.id)
    if (i >= 0) entries.splice(i, 1)
    entries.unshift(entry)
    if (entries.length > MAX_ENTRIES) entries.splice(MAX_ENTRIES)
  }
  function remove(id: string): void {
    const i = entries.findIndex((e) => e.id === id)
    if (i >= 0) entries.splice(i, 1)
  }
  function has(id: string): boolean {
    return entries.some((e) => e.id === id)
  }
  return { entries, minimize, remove, has }
}

// Stable dedupe id for a preview: prefer the real workspace file path, else name.
export function previewDockId(ref: PreviewRef): string {
  return ref.workspaceRoot && ref.path
    ? `preview:${ref.workspaceRoot}:${ref.path}`
    : `preview:${ref.name}`
}
