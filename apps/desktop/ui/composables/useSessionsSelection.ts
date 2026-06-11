// Bulk selection for the Sessions sidebar — a Set of session ids, independent of
// the single-item navigation (`store.selectedSessionId`) so ticking rows for a
// bulk delete never changes which session is open in the detail pane. Mirrors
// the Agents/Skills bulk-select pattern: an always-visible checkbox per row + a
// floating action bar that appears once anything is selected.
export function useSessionsSelection() {
  const store = useSessionsStore()

  const bulkSelection = ref<Set<string>>(new Set())
  // Ids parked for the confirm dialog. Snapshotted on ask so deletions can't
  // race a checkbox change while the modal is open.
  const bulkPendingDelete = ref<string[] | null>(null)

  const toggleBulk = (id: string) => {
    const next = new Set(bulkSelection.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    bulkSelection.value = next
  }

  const clearBulk = () => {
    bulkSelection.value = new Set()
  }

  // Select-all works over the currently-visible (filtered) ids the page passes
  // in, so search/filter narrows what "all" means and ticks on hidden rows are
  // preserved across a deselect-all.
  const allVisibleSelected = (ids: string[]): boolean =>
    ids.length > 0 && ids.every((id) => bulkSelection.value.has(id))

  const someVisibleSelected = (ids: string[]): boolean =>
    ids.some((id) => bulkSelection.value.has(id))

  const toggleSelectAll = (ids: string[]) => {
    const next = new Set(bulkSelection.value)
    if (allVisibleSelected(ids)) ids.forEach((id) => next.delete(id))
    else ids.forEach((id) => next.add(id))
    bulkSelection.value = next
  }

  const askBulkDelete = () => {
    if (bulkSelection.value.size === 0) return
    bulkPendingDelete.value = [...bulkSelection.value]
  }

  const confirmBulkDelete = () => {
    const ids = bulkPendingDelete.value
    if (!ids || ids.length === 0) return
    bulkPendingDelete.value = null
    // deleteSession is optimistic (sync store mutation + fire-and-forget sidecar
    // delete), so a plain loop is enough — no per-item await/spinner needed.
    ids.forEach((id) => store.deleteSession(id))
    clearBulk()
  }

  return {
    bulkSelection,
    bulkPendingDelete,
    toggleBulk,
    clearBulk,
    allVisibleSelected,
    someVisibleSelected,
    toggleSelectAll,
    askBulkDelete,
    confirmBulkDelete,
  }
}
