// DAG lane assignment for git history graph rendering.
//
// Shared by GitHistoryGraph (renders SVG) and GitHistoryTable (computes
// padding so the table columns start after the graph, not under it).
//
// Algorithm (newest commits first):
//   1. activeLanes[i] = sha of the commit expected at lane i next.
//   2. For each commit:
//      - lane = indexOf(commit.hash) in activeLanes, else append new lane.
//      - Emit convergence edges from every active lane holding this sha → our lane.
//      - Emit straight-through edges for unrelated lanes (continue down).
//      - Update activeLanes: drop commit.sha occurrences, put first parent in our
//        lane, other parents into empty slots (preferred) or new rightmost slots.
import type { GitCommit } from '~/types'

export interface DagDot {
  hash: string
  lane: number
  row: number
}

export interface DagEdge {
  fromLane: number
  toLane: number
  fromRow: number
  toRow: number
}

export interface DagLayout {
  dots: DagDot[]
  edges: DagEdge[]
  laneCount: number
}

export function computeDagLayout(commits: GitCommit[]): DagLayout {
  const dots: DagDot[] = []
  const edges: DagEdge[] = []
  let activeLanes: (string | null)[] = []
  let maxLane = 0

  commits.forEach((commit, row) => {
    // 1. Resolve own lane.
    let lane = activeLanes.indexOf(commit.hash)
    if (lane === -1) {
      lane = activeLanes.length
      activeLanes.push(null)
    }
    if (lane > maxLane) maxLane = lane

    // 2. Convergence edges — every lane that was waiting for this sha (incl.
    //    our own lane, when our lane already pointed at us) connects to our dot.
    //    Without including `l === lane`, a commit that's just the first parent
    //    of the previous row would render a floating dot with no line above it.
    for (let l = 0; l < activeLanes.length; l += 1) {
      if (activeLanes[l] === commit.hash) {
        edges.push({ fromLane: l, fromRow: row - 1, toLane: lane, toRow: row })
      }
    }

    // 3. Straight-through edges for unrelated lanes (passing through this row).
    if (row > 0) {
      for (let l = 0; l < activeLanes.length; l += 1) {
        if (l === lane) continue
        const slot = activeLanes[l]
        if (slot === null || slot === commit.hash) continue
        edges.push({ fromLane: l, fromRow: row - 1, toLane: l, toRow: row })
      }
    }

    dots.push({ hash: commit.hash, lane, row })

    // 4. Update activeLanes for the next iteration.
    const nextLanes: (string | null)[] = []
    for (let l = 0; l < activeLanes.length; l += 1) {
      if (l === lane) {
        nextLanes.push(null) // filled with first parent below
      } else if (activeLanes[l] === commit.hash) {
        // merged in — drop
      } else {
        nextLanes.push(activeLanes[l] ?? null)
      }
    }
    const [firstParent, ...otherParents] = commit.parents
    nextLanes[lane] = firstParent ?? null
    otherParents.forEach((p) => {
      const emptyIdx = nextLanes.indexOf(null, 0)
      if (emptyIdx >= 0 && emptyIdx !== lane) {
        nextLanes[emptyIdx] = p
        edges.push({ fromLane: lane, fromRow: row, toLane: emptyIdx, toRow: row + 1 })
      } else {
        nextLanes.push(p)
        const newLane = nextLanes.length - 1
        if (newLane > maxLane) maxLane = newLane
        edges.push({ fromLane: lane, fromRow: row, toLane: newLane, toRow: row + 1 })
      }
    })
    activeLanes = nextLanes
  })

  return { dots, edges, laneCount: maxLane + 1 }
}
