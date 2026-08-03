// Shared classification of markdown link hrefs, used by both the transcript renderer
// (SessionMarkdownHtml) and the shared PreviewModal so a clicked link behaves the same
// in both. An "internal" href (a relative / workspace file path) must be intercepted
// and opened in the preview — letting the SPA router follow a bare doc path like
// `tasks/…/review.md` navigates to a dead route (404). External URLs (http(s)://,
// mailto:, tel:) and in-page anchors (#…) keep their default browser behaviour.

const EXTERNAL_HREF_RE = /^([a-z][a-z\d+.-]*:\/\/|mailto:|tel:)/i

// True when `href` points at an in-app workspace file (should be opened in the
// preview); false for empty, in-page anchors (#…), and external URLs (left to default
// handling). Trims internally so callers can pass a raw attribute value.
export function isInternalFileHref(href: string): boolean {
  const h = href.trim()
  if (!h || h.startsWith('#')) return false
  return !EXTERNAL_HREF_RE.test(h)
}
