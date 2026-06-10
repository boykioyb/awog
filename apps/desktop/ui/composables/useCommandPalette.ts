import type { Component, Ref } from 'vue'
import { computed, ref, watch } from 'vue'
import type { FsEntry } from '~/types'
import { fuzzyMatch, type FuzzyResult } from '~/utils/fuzzy'
import { useWorkspaceFileIndex } from '~/composables/useWorkspaceFileIndex'

// A command/action surfaced in the palette's command mode. `run` is the action
// closure (defined by the page, so it can reach the workspace handlers).
export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  icon?: Component
  run: () => void
}

export type PaletteItem =
  | { kind: 'file'; id: string; label: string; path: string; positions: number[] }
  | {
      kind: 'command'
      id: string
      label: string
      hint?: string
      icon?: Component
      command: PaletteCommand
      positions: number[]
    }

// Mirror useMentionAutocomplete: cap rendered rows, surface the cap via a title
// (the list is already in memory — the only lever is a narrower query).
const RESULT_LIMIT = 50

/**
 * Drives the CommandPalette: derives the mode from a leading `>` in the query,
 * fuzzy-ranks files (quick open) or commands, and owns arrow-key navigation.
 * The `.vue` stays a thin view (page-controller pattern, like SessionAutocomplete).
 */
export function useCommandPalette(
  query: Ref<string>,
  workspaceRoot: Ref<string>,
  commands: Ref<PaletteCommand[]>,
) {
  const fileIndex = useWorkspaceFileIndex()
  const activeIndex = ref(0)

  // `>` (VSCode convention) forces command mode; otherwise it's file/quick-open.
  const mode = computed<'file' | 'command'>(() =>
    query.value.startsWith('>') ? 'command' : 'file',
  )
  const term = computed(() =>
    (query.value.startsWith('>') ? query.value.slice(1) : query.value).trim(),
  )

  const files = computed<FsEntry[]>(() =>
    mode.value === 'file' && workspaceRoot.value
      ? fileIndex.ensureLoaded(workspaceRoot.value).value
      : [],
  )

  const total = ref(0) // matches before the RESULT_LIMIT slice (for the cap hint)

  const items = computed<PaletteItem[]>(() => {
    const q = term.value

    if (mode.value === 'command') {
      if (q.length === 0) {
        total.value = commands.value.length
        return commands.value.slice(0, RESULT_LIMIT).map((c) => ({
          kind: 'command',
          id: c.id,
          label: c.label,
          hint: c.hint,
          icon: c.icon,
          command: c,
          positions: [],
        }))
      }
      const scored = commands.value
        .map((c) => {
          const r = fuzzyMatch(q, c.label)
          return r ? { c, r } : null
        })
        .filter((x): x is { c: PaletteCommand; r: FuzzyResult } => x !== null)
        .sort((a, b) => b.r.score - a.r.score)
      total.value = scored.length
      return scored.slice(0, RESULT_LIMIT).map(({ c, r }) => ({
        kind: 'command',
        id: c.id,
        label: c.label,
        hint: c.hint,
        icon: c.icon,
        command: c,
        positions: r.positions,
      }))
    }

    // File / quick-open mode.
    if (q.length === 0) {
      total.value = files.value.length
      return files.value.slice(0, RESULT_LIMIT).map((f) => ({
        kind: 'file',
        id: f.path,
        label: f.name,
        path: f.path,
        positions: [],
      }))
    }
    const scored: { f: FsEntry; r: FuzzyResult }[] = []
    for (const f of files.value) {
      const r = fuzzyMatch(q, f.path)
      if (r) scored.push({ f, r })
    }
    scored.sort((a, b) => b.r.score - a.r.score)
    total.value = scored.length
    return scored.slice(0, RESULT_LIMIT).map(({ f, r }) => ({
      kind: 'file',
      id: f.path,
      label: f.name,
      path: f.path,
      positions: r.positions,
    }))
  })

  // Reset the cursor whenever the result set changes (keeps a valid selection).
  watch(items, () => {
    activeIndex.value = 0
  })

  const active = computed<PaletteItem | null>(() => items.value[activeIndex.value] ?? null)
  const capped = computed(() => total.value > items.value.length)

  const moveDown = () => {
    const n = items.value.length
    if (n) activeIndex.value = (activeIndex.value + 1) % n
  }
  const moveUp = () => {
    const n = items.value.length
    if (n) activeIndex.value = (activeIndex.value - 1 + n) % n
  }

  return { mode, items, activeIndex, active, capped, moveDown, moveUp }
}
