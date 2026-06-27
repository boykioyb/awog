// Per-session cost + budget helpers, shared by the composer budget chip and the
// detail usage panel. Cost is computed sidecar-side (single source of truth =
// pricing/catalog) and summed cumulatively into session.usage.cost; the soft budget
// (session.budget.limitUsd) is a warning-only cap (hard caps are enforced sidecar-side
// in Phase 3). Pure formatting/derivation — no state, no IPC.

import type { Session } from '~/composables/useSessionsMock'

export function useSessionCost() {
  // Format a USD figure with sensible precision (sub-cent turns shouldn't read $0.00).
  function fmtUsd(n: number | undefined): string {
    if (n == null) return '—'
    if (n === 0) return '$0'
    if (n < 0.01) return `$${n.toFixed(4)}`
    if (n < 1) return `$${n.toFixed(3)}`
    return `$${n.toFixed(2)}`
  }

  const costOf = (s: Session | null | undefined): number | undefined => s?.usage?.cost
  const softLimit = (s: Session | null | undefined): number | undefined => s?.budget?.limitUsd

  // True once the cumulative cost exceeds the soft limit (warning only).
  function overSoft(s: Session | null | undefined): boolean {
    const c = costOf(s)
    const l = softLimit(s)
    return c != null && l != null && l > 0 && c > l
  }

  // Whether to show a budget readout at all (priced turn ran OR a limit is set).
  function hasBudgetInfo(s: Session | null | undefined): boolean {
    return costOf(s) != null || (softLimit(s) ?? 0) > 0
  }

  return { fmtUsd, costOf, softLimit, overSoft, hasBudgetInfo }
}
