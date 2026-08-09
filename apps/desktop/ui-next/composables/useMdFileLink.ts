import { toValue, type MaybeRefOrGetter } from 'vue'
import { usePreview, previewKindFromPath } from './usePreview'
import { useFilePreview } from './useFilePreview'
import { isInternalFileHref, normalizeWorkspacePath } from '~/utils/file-links'

// One delegated click handler for every rendered-markdown surface that isn't the session
// transcript or the PreviewModal (those two resolve a clicked path against their own file
// index). Bind it on the markdown container — one listener covers all its links:
//
//   <div class="mdbody" @click="onMdLinkClick">
//
// WHY: an `<a href="backend/app/x.py">` written by the model must NEVER reach the SPA
// router. There is no such route, so Nuxt renders a full-page 404 ("Page not found:
// /backend/app/…") and every bit of app state — the open session, the doc being read — is
// gone. So the handler always cancels the navigation for an internal path, then opens the
// file in the ONE shared PreviewModal (memory: single-file-preview-modal).
//
// Resolution, in order:
//   1. `workspaceRoot` — a surface that knows the doc's project root (e.g. the task
//      artifact editor) opens the path directly under it.
//   2. useFilePreview — when the surface sits under a session transcript host, its
//      resolver matches the written path against the real workspace file index.
//   3. neither → the click is inert. The navigation stays cancelled either way, which is
//      the point: a doc with no workspace behind it (a skill/agent body) can't 404 the app.
export function useMdFileLink(workspaceRoot?: MaybeRefOrGetter<string | null | undefined>) {
  const preview = usePreview()
  const filePreview = useFilePreview()

  function onMdLinkClick(e: MouseEvent): void {
    const a = (e.target as HTMLElement | null)?.closest('a')
    if (!a) return
    const href = (a.getAttribute('href') ?? '').trim()
    if (!isInternalFileHref(href)) return // external URL / #anchor → default handling
    e.preventDefault()
    const root = toValue(workspaceRoot)
    const path = root ? normalizeWorkspacePath(href) : null
    if (root && path) {
      preview.open({
        name: path.split('/').pop() || path,
        kind: previewKindFromPath(path),
        workspaceRoot: root,
        path,
      })
      return
    }
    filePreview.open(href)
  }

  return { onMdLinkClick }
}
