// Derive the "context files" of a session — every file fed into the model as
// context — for the Info panel. Ports the old UI's SessionInfo "Files" section
// (apps/desktop/ui/composables/useSessionInfo.ts → contextFiles) to ui-next, plus
// the new pinned-context working-set:
//
//   - folder     : the dragged working folder (session cwd, re-fed every turn)
//   - attachment : files/images attached to a user message (deduped across turns)
//   - pinned     : workspace files pinned to the session (re-fed every turn)
//
// Clicking a row opens the shared PreviewModal (usePreview): the folder opens its
// file tree; attachments preview from their inline src/text; pinned files read from
// the resolved workspace root. SoC: derivation + preview wiring only — no IPC, no fs.

import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Session, SessionAttachment } from '~/composables/useSessionsData'
import {
  usePreview,
  imageSiblingsFromAttachments,
  previewKindFromPath,
  previewRefFromAttachment,
  type PreviewRef,
} from '~/composables/usePreview'
import { useWorkspaceData } from '~/composables/useWorkspaceData'

export type SessionContextFile =
  | { kind: 'folder'; key: string; name: string; path: string }
  | { kind: 'attachment'; key: string; name: string; size?: number; att: SessionAttachment }
  | { kind: 'pinned'; key: string; name: string; path: string }

// Last path segment, tolerant of POSIX + Windows separators.
const baseName = (p: string): string =>
  p
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop() || p

export function useSessionContextFiles(session: MaybeRefOrGetter<Session | null | undefined>) {
  const { open } = usePreview()
  // Resolve the session's workspace root so pinned (relative) files can be read by
  // the preview modal. Reactive to the active session's project.
  const { root } = useWorkspaceData(() => toValue(session)?.project)

  const contextFiles = computed<SessionContextFile[]>(() => {
    const s = toValue(session)
    if (!s) return []
    const out: SessionContextFile[] = []

    // Working folder (dragged in) — the session cwd, fed into every turn. Listed
    // first as the primary standing context.
    if (s.workspaceFolder) {
      out.push({
        kind: 'folder',
        key: `folder-${s.workspaceFolder}`,
        name: baseName(s.workspaceFolder),
        path: s.workspaceFolder,
      })
    }

    // Attachments across all user turns (deduped by name+size — ui-next attachments
    // carry no stable id).
    const seen = new Set<string>()
    for (const m of s.msgs) {
      if (m.role !== 'user' || !m.att) continue
      for (const a of m.att) {
        if (a.folder) continue // folder atts are surfaced via the working-folder row
        const dedupe = `${a.name}::${a.size ?? ''}`
        if (seen.has(dedupe)) continue
        seen.add(dedupe)
        out.push({
          kind: 'attachment',
          key: `att-${dedupe}`,
          name: a.name,
          ...(a.size != null ? { size: a.size } : {}),
          att: a,
        })
      }
    }

    // Pinned working-set files (re-fed every turn).
    for (const f of s.pinnedContext?.files ?? []) {
      out.push({ kind: 'pinned', key: `pin-${f}`, name: f.split('/').pop() || f, path: f })
    }
    return out
  })

  // Attachments currently listed by the panel — the sibling set handed to an attachment
  // preview so its ‹ › steps through this context, not a folder on disk.
  const attachmentsOf = (): SessionAttachment[] =>
    contextFiles.value.flatMap((f) => (f.kind === 'attachment' ? [f.att] : []))

  // Open a context file in the shared PreviewModal.
  function openContextFile(file: SessionContextFile): void {
    if (file.kind === 'folder') {
      // The folder's own path IS the root — open the lazy tree.
      open({ kind: 'folder', name: file.name, workspaceRoot: file.path })
      return
    }
    if (file.kind === 'attachment') {
      // Siblings = the other attachments of this session's context, so stepping stays inside
      // the set the panel is showing.
      open(previewRefFromAttachment(file.att), imageSiblingsFromAttachments(attachmentsOf()))
      return
    }
    // Pinned: read from the resolved workspace root (degrades to a placeholder when
    // unresolved / browser-dev, like useFilePreview).
    const item: PreviewRef = { name: file.name, kind: previewKindFromPath(file.name) }
    if (root.value) {
      item.workspaceRoot = root.value
      item.path = file.path
    }
    open(item)
  }

  return { contextFiles, openContextFile }
}
