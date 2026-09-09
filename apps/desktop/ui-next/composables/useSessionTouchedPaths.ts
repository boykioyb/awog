// Derive the set of workspace files a Session "touched" — i.e. wrote or edited.
// Shared by the Diff tab (which intersects this with git.status to show only the
// session's changes) and the Preview tab (which renders the markdown artifacts the
// session produced). SoC: a pure derivation over the transcript, no IPC/fs/git.
//
// A session touched a file when one of its file-writing tool steps (Write / Edit /
// MultiEdit / NotebookEdit — including subagent steps) named it. These labels are
// emitted verbatim by the sidecar step-mapper (humanLabel), so matching on the label
// is stable; Read / search / terminal steps don't reliably name an edited path.
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Session } from '~/composables/useSessionsData'

// The tools that name a file they WROTE. Exported because it is the one place that
// knowledge lives — useSessionMediaIndex reads the same set when it walks the
// transcript for the Info tab's docs list.
export const WRITE_LABELS = new Set(['Write', 'Edit', 'Edit (multi)', 'Edit notebook'])

// Normalise a step target (absolute or workspace-relative, possibly anchored to an
// ancestor cwd — see memory session-file-link-path-base) toward a workspace-relative
// path. Strips the resolved root prefix when the target is absolute under it.
export function workspaceRelative(target: string, root: string | null): string {
  let p = target.trim().replace(/\\/g, '/')
  if (p.startsWith('/') && root && p.startsWith(root)) p = p.slice(root.length)
  return p.replace(/^\.\//, '').replace(/^\/+/, '')
}

export function useSessionTouchedPaths(
  session: MaybeRefOrGetter<Session>,
  root: MaybeRefOrGetter<string | null>,
) {
  // Workspace-relative paths the session wrote/edited, in first-touch order (the Set
  // dedupes repeated edits to the same file while preserving stable ordering).
  const touchedPaths = computed<string[]>(() => {
    const out = new Set<string>()
    const add = (tool: string, target: string): void => {
      if (target && WRITE_LABELS.has(tool)) {
        const n = workspaceRelative(target, toValue(root))
        if (n) out.add(n)
      }
    }
    for (const m of toValue(session).msgs) {
      if (m.role !== 'assistant') continue
      for (const b of m.blocks) {
        if (b.kind !== 'step') continue
        add(b.tool, b.target)
        if (b.sub) for (const s of b.sub.steps) add(s.tool, s.target)
      }
    }
    return [...out]
  })

  return { touchedPaths }
}
