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

const WRITE_LABELS = new Set(['Write', 'Edit', 'Edit (multi)', 'Edit notebook'])

export function useSessionTouchedPaths(
  session: MaybeRefOrGetter<Session>,
  root: MaybeRefOrGetter<string | null>,
) {
  // Normalise a step target (absolute or workspace-relative, possibly anchored to an
  // ancestor cwd — see memory session-file-link-path-base) toward a workspace-relative
  // path. Strips the resolved root prefix when the target is absolute under it.
  function normalize(target: string): string {
    let p = target.trim().replace(/\\/g, '/')
    const r = toValue(root)
    if (p.startsWith('/') && r && p.startsWith(r)) p = p.slice(r.length)
    return p.replace(/^\.\//, '').replace(/^\/+/, '')
  }

  // Workspace-relative paths the session wrote/edited, in first-touch order (the Set
  // dedupes repeated edits to the same file while preserving stable ordering).
  const touchedPaths = computed<string[]>(() => {
    const out = new Set<string>()
    const add = (tool: string, target: string): void => {
      if (target && WRITE_LABELS.has(tool)) {
        const n = normalize(target)
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
