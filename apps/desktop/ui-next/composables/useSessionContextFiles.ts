// Derive the "context files" of a session — every file fed into the model as
// context — for the Info panel. Ports the old UI's SessionInfo "Files" section
// (apps/desktop/ui/composables/useSessionInfo.ts → contextFiles) to ui-next, plus
// the new pinned-context working-set:
//
//   - attachment : files/images attached to a user message (deduped across turns)
//   - pinned     : workspace files pinned to the session (re-fed every turn)
//
// Clicking a row opens the shared PreviewModal (usePreview): attachments preview
// from their inline src/text; pinned files read from the resolved workspace root.
// SoC: derivation + preview wiring only — no IPC, no fs.

import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Session, SessionAttachment } from '~/composables/useSessionsMock'
import { usePreview, type PreviewRef } from '~/composables/usePreview'
import { useWorkspaceData } from '~/composables/useWorkspaceData'

export type SessionContextFile =
  | { kind: 'attachment'; key: string; name: string; size?: number; att: SessionAttachment }
  | { kind: 'pinned'; key: string; name: string; path: string }

// Mirror SessionAttachmentChip.kindOf so an Info-panel row previews identically to
// the in-bubble chip.
function attKind(a: SessionAttachment): PreviewRef['kind'] {
  if (a.img) return 'image'
  if (a.src && (a.mime === 'application/pdf' || /\.pdf$/i.test(a.name))) return 'pdf'
  if (a.text != null && /\.(md|markdown)$/i.test(a.name)) return 'markdown'
  if (a.text != null) return 'text'
  return 'file'
}

function pinnedKind(name: string): PreviewRef['kind'] {
  if (/\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(name)) return 'image'
  if (/\.pdf$/i.test(name)) return 'pdf'
  if (/\.(md|markdown|mdx)$/i.test(name)) return 'markdown'
  return 'text'
}

export function useSessionContextFiles(session: MaybeRefOrGetter<Session | null | undefined>) {
  const { open } = usePreview()
  // Resolve the session's workspace root so pinned (relative) files can be read by
  // the preview modal. Reactive to the active session's project.
  const { root } = useWorkspaceData(() => toValue(session)?.project)

  const contextFiles = computed<SessionContextFile[]>(() => {
    const s = toValue(session)
    if (!s) return []
    const out: SessionContextFile[] = []

    // Attachments across all user turns (deduped by name+size — ui-next attachments
    // carry no stable id).
    const seen = new Set<string>()
    for (const m of s.msgs) {
      if (m.role !== 'user' || !m.att) continue
      for (const a of m.att) {
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

  // Open a context file in the shared PreviewModal.
  function openContextFile(file: SessionContextFile): void {
    if (file.kind === 'attachment') {
      const a = file.att
      const item: PreviewRef = { name: a.name, kind: attKind(a) }
      if (a.src) item.src = a.src
      if (a.text != null) item.text = a.text
      if (a.size != null) item.size = a.size
      if (a.mime) item.mime = a.mime
      open(item)
      return
    }
    // Pinned: read from the resolved workspace root (degrades to a placeholder when
    // unresolved / browser-dev, like useFilePreview).
    const item: PreviewRef = { name: file.name, kind: pinnedKind(file.name) }
    if (root.value) {
      item.workspaceRoot = root.value
      item.path = file.path
    }
    open(item)
  }

  return { contextFiles, openContextFile }
}
