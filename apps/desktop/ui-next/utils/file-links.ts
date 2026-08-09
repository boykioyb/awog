// Shared classification + normalization of markdown link hrefs, used by every rendered-
// markdown surface (the transcript, the PreviewModal, and useMdFileLink for the rest) so a
// clicked link behaves the same everywhere. An "internal" href (a relative / workspace file
// path) must be intercepted and opened in the preview — letting the SPA router follow a bare
// doc path like `tasks/…/review.md` navigates to a dead route (404). External URLs
// (http(s)://, mailto:, tel:) and in-page anchors (#…) keep their default browser behaviour.

const EXTERNAL_HREF_RE = /^([a-z][a-z\d+.-]*:\/\/|mailto:|tel:)/i

// True when `href` points at an in-app workspace file (should be opened in the
// preview); false for empty, in-page anchors (#…), and external URLs (left to default
// handling). Trims internally so callers can pass a raw attribute value.
export function isInternalFileHref(href: string): boolean {
  const h = href.trim()
  if (!h || h.startsWith('#')) return false
  return !EXTERNAL_HREF_RE.test(h)
}

// Resolve a markdown link/asset ref to a normalized workspace-relative path, or null when
// it's empty or climbs out of the workspace (invariant #2, defence-in-depth on top of the
// sidecar's assertInsideWorkspace). `baseDir` is the directory of the file the ref was
// written in — '' anchors at the workspace root, which is also what a leading `/` means
// (a doc's `/backend/app/x.py` is root-relative, not filesystem-absolute). Query strings
// and fragments are dropped; percent-escapes are decoded so a non-ASCII filename matches
// the real file.
export function normalizeWorkspacePath(ref: string, baseDir = ''): string | null {
  let s = ref.split(/[?#]/)[0] ?? ''
  try {
    s = decodeURIComponent(s)
  } catch {
    // not valid percent-encoding → use the raw string
  }
  const base = s.startsWith('/') ? '' : baseDir
  const parts = (base ? base.split('/') : []).concat(s.replace(/^\/+/, '').split('/'))
  const out: string[] = []
  for (const seg of parts) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (!out.length) return null
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.length ? out.join('/') : null
}
