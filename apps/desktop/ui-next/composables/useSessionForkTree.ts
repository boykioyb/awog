// Build a fork-lineage tree for a session from the loaded session list. Forks
// record `parentSessionId` (the parent's engineId) + `forkFromMessageId`; this
// composable walks up to the lineage root, then DFS-collects the whole subtree so
// the fork-tree graph (SessionForkGraph) can lay it out. Pure derivation over the
// sessions store — no IPC.

import type { Session } from '~/composables/useSessionsMock'
import { useSessionsStore } from '~/stores/sessions'

export type ForkNode = {
  // Stable graph id (engineId when present, else a synthetic client-id key so a
  // not-yet-persisted local fork still renders).
  id: string
  clientId: number
  title: string
  when: string
  isCurrent: boolean
  // Tree depth (→ x) and pre-order row (→ y) for layout.
  depth: number
  row: number
}
export type ForkEdge = { from: string; to: string }
export type ForkTree = { nodes: ForkNode[]; edges: ForkEdge[]; hasLineage: boolean }

export function useSessionForkTree() {
  const store = useSessionsStore()

  function treeFor(clientId: number): ForkTree {
    const sessions = store.sessions
    const target = sessions.find((s) => s.id === clientId)
    if (!target) return { nodes: [], edges: [], hasLineage: false }

    const byEid = new Map<string, Session>()
    for (const s of sessions) if (s.engineId) byEid.set(s.engineId, s)
    const childrenOf = (eid: string): Session[] => sessions.filter((s) => s.parentSessionId === eid)
    const idOf = (s: Session): string => s.engineId ?? `c-${s.id}`

    // Walk up to the lineage root (guard against cycles).
    let root = target
    const seenUp = new Set<number>()
    while (root.parentSessionId && byEid.has(root.parentSessionId) && !seenUp.has(root.id)) {
      seenUp.add(root.id)
      root = byEid.get(root.parentSessionId) as Session
    }

    const nodes: ForkNode[] = []
    const edges: ForkEdge[] = []
    const seen = new Set<number>()
    let row = 0
    const visit = (s: Session, depth: number): void => {
      if (seen.has(s.id)) return // cycle guard
      seen.add(s.id)
      nodes.push({
        id: idOf(s),
        clientId: s.id,
        title: s.title,
        when: s.when,
        isCurrent: s.id === clientId,
        depth,
        row: row++,
      })
      if (!s.engineId) return
      for (const k of childrenOf(s.engineId)) {
        edges.push({ from: idOf(s), to: idOf(k) })
        visit(k, depth + 1)
      }
    }
    visit(root, 0)

    return { nodes, edges, hasLineage: nodes.length > 1 }
  }

  return { treeFor }
}
