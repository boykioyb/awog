import { computed, ref, type ComputedRef } from 'vue'

// Incremental list rendering ("load more") for the in-memory lists. All entities
// live client-side, so this is a *render* window — not server pagination — that
// keeps the DOM small on large lists: render the first `pageSize` rows, then grow
// the window on demand (scroll/click) via <LoadMoreSentinel>.
//
// Usage (page-controller / list component):
//   const lm = useLoadMore(() => filtered.value)   // window the filtered list
//   // render lm.visible instead of the full list; group from lm.visible too
//   // call lm.reset() when the *query/filter* changes (show results from top)
//
// `source` is a getter so the window tracks a reactive computed (e.g. `filtered`).
// `reset()` is left to the caller to invoke on filter changes — windowing must NOT
// jump back to the top when the live store merely appends a new row.

export const LOAD_MORE_PAGE_SIZE = 60

// Default rows shown per group before a per-group "load more" appears. Grouped
// lists (sessions by project, library by tier) start collapsed-ish: each group
// renders only this many rows, with its own button to reveal the next page.
export const GROUP_PAGE_SIZE = 5

export type LoadMore<T> = {
  /** The current render window (first `shown` items, or the whole list once exhausted). */
  visible: ComputedRef<T[]>
  /** Total items in the source. */
  total: ComputedRef<number>
  /** How many items are currently rendered. */
  shown: ComputedRef<number>
  /** Whether more items remain beyond the window. */
  hasMore: ComputedRef<boolean>
  /** Items still hidden below the window. */
  remaining: ComputedRef<number>
  /** Grow the window by `step` (default `pageSize`), capped at total. */
  loadMore: (step?: number) => void
  /** Shrink the window back to one page (call when the query/filter changes). */
  reset: () => void
}

export function useLoadMore<T>(source: () => T[], pageSize = LOAD_MORE_PAGE_SIZE): LoadMore<T> {
  const shownCount = ref(pageSize)
  const all = computed(source)
  const total = computed(() => all.value.length)
  // Avoid copying when the window already covers everything (the common case).
  const visible = computed(() =>
    shownCount.value >= all.value.length ? all.value : all.value.slice(0, shownCount.value),
  )
  const hasMore = computed(() => shownCount.value < total.value)
  const remaining = computed(() => Math.max(0, total.value - shownCount.value))

  function loadMore(step = pageSize) {
    shownCount.value = Math.min(total.value, shownCount.value + step)
  }
  function reset() {
    shownCount.value = pageSize
  }

  return {
    visible,
    total,
    shown: computed(() => shownCount.value),
    hasMore,
    remaining,
    loadMore,
    reset,
  }
}

export type GroupWindow<T> = {
  items: T[]
  /** First `limit` items of the group (or all once exhausted). */
  visible: T[]
  /** Whether the group has rows beyond the window. */
  hasMore: boolean
  /** Rows still hidden in this group. */
  remaining: number
}

export type GroupLoadMore = {
  pageSize: number
  /** Apply the per-group window to a `{ key, items }` bucket. */
  windowOf: <T>(key: string, items: T[]) => GroupWindow<T>
  /** Grow one group's window by `step` (default `pageSize`). */
  loadMore: (key: string, step?: number) => void
  /** Collapse every group back to the first page (call on query/filter change). */
  reset: () => void
}

// Per-group render window for grouped lists: each group key tracks its own row
// count (default `pageSize`), grown independently via a per-group "load more"
// button. Keep counts in plain reactive state keyed by group key — groups whose
// key is absent fall back to `pageSize`.
export function useGroupLoadMore(pageSize = GROUP_PAGE_SIZE): GroupLoadMore {
  const limits = ref<Record<string, number>>({})
  const limitFor = (key: string) => limits.value[key] ?? pageSize

  function windowOf<T>(key: string, items: T[]): GroupWindow<T> {
    const limit = limitFor(key)
    return {
      items,
      visible: items.length > limit ? items.slice(0, limit) : items,
      hasMore: items.length > limit,
      remaining: Math.max(0, items.length - limit),
    }
  }
  function loadMore(key: string, step = pageSize) {
    // Reassign (not mutate) so the `groups` computed that reads limits re-runs.
    limits.value = { ...limits.value, [key]: limitFor(key) + step }
  }
  function reset() {
    limits.value = {}
  }

  return { pageSize, windowOf, loadMore, reset }
}
