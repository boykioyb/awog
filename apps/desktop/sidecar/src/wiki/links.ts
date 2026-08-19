// `[[wikilink]]` parsing + resolution (ADR 0073 D-4).
//
// Accepted forms: `[[slug]]`, `[[slug|label]]`, `[[slug#heading]]`. Resolution is
// deliberately forgiving because links are written by hand: an exact slug wins,
// then a sibling inside the linking page's own space, then a unique page whose
// last segment matches. Anything else is a dead link — surfaced in the UI as a
// dashed link that offers to create the page, never a silent miss.

// Whole-link matcher. The target stops at `#`, `|` or `]` so a heading anchor or
// a label never leaks into the slug.
const WIKILINK_RE = /\[\[\s*([^\]|#\n]+?)\s*(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g

export interface WikiLink {
  target: string
  label?: string
}

export function extractWikiLinks(text: string): WikiLink[] {
  const out: WikiLink[] = []
  for (const m of text.matchAll(WIKILINK_RE)) {
    const target = m[1].trim()
    if (!target) continue
    const label = m[2]?.trim()
    out.push(label ? { target, label } : { target })
  }
  return out
}

// Normalise a link target the same way a slug is normalised, but WITHOUT throwing:
// a malformed link is a dead link, not an error.
function looseNormalise(target: string): string {
  return target
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.(md|markdown|mdx)$/i, '')
}

function lastSegment(slug: string): string {
  const idx = slug.lastIndexOf('/')
  return idx === -1 ? slug : slug.slice(idx + 1)
}

function spaceOf(slug: string): string {
  const idx = slug.indexOf('/')
  return idx === -1 ? '' : slug.slice(0, idx)
}

// Resolve a link target against the known slugs. `fromSlug` is the page holding
// the link — it decides the "same space" shortcut.
export function resolveWikiLink(
  target: string,
  fromSlug: string,
  slugs: readonly string[],
): string | null {
  const wanted = looseNormalise(target)
  if (!wanted) return null
  const lower = wanted.toLowerCase()

  const exact = slugs.find((s) => s.toLowerCase() === lower)
  if (exact) return exact

  const space = spaceOf(fromSlug)
  if (space) {
    const sibling = slugs.find((s) => s.toLowerCase() === `${space.toLowerCase()}/${lower}`)
    if (sibling) return sibling
  }

  // Unique suffix match — `[[data-flow]]` from anywhere finds
  // `architecture/data-flow` as long as no other page shares that last segment.
  const suffixHits = slugs.filter((s) => lastSegment(s).toLowerCase() === lower)
  return suffixHits.length === 1 ? suffixHits[0] : null
}

// The two fixed-string needles that can possibly contain a link to `slug`:
// the full-path form and the short last-segment form. Used to grep for backlinks
// instead of reading every page (ReDoS-safe, and fast on a large wiki).
export function backlinkNeedles(slug: string): string[] {
  const needles = new Set([`[[${slug}`, `[[${lastSegment(slug)}`]);
  return [...needles]
}

// Confirm a grepped line really links to `slug` (the needle is a prefix match, so
// `[[data-flow-v2]]` would otherwise count as a hit on `data-flow`).
export function lineLinksTo(line: string, slug: string, fromSlug: string, slugs: readonly string[]): boolean {
  return extractWikiLinks(line).some((link) => resolveWikiLink(link.target, fromSlug, slugs) === slug)
}
