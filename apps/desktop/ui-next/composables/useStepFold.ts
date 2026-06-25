// Transcript-wide collapse/expand broadcast for tool steps + clusters.
// A module-level reactive signal (mode + monotonically increasing seq) acts as a
// one-shot broadcast: SessionTranscript flips it, every SessionStepItem /
// SessionCluster `watch`es `seq` and forces its own open/closed state to match
// `mode`. Bumping seq (instead of toggling a shared boolean) re-fires the watcher
// even when the requested mode equals the previous one, so a second "expand all"
// still re-opens steps the user closed manually in between. Pure UI state → a
// shared composable, not a Pinia store.

type FoldMode = 'collapse' | 'expand'

// Shared across every component instance (declared once at module load).
const signal = reactive<{ mode: FoldMode; seq: number }>({ mode: 'collapse', seq: 0 })

export function useStepFold() {
  const collapseAll = (): void => {
    signal.mode = 'collapse'
    signal.seq++
  }
  const expandAll = (): void => {
    signal.mode = 'expand'
    signal.seq++
  }
  return { signal: readonly(signal), collapseAll, expandAll }
}
