// Follow-up anchors — the numbered superscript badge (①②③) injected into a
// rendered agent message at the spot the user quoted, linking it to the matching
// numbered quote card in their reply. The badge is plain DOM (lives inside the
// v-html'd markdown, where Vue components can't), re-applied by SessionMessageList
// on every content mutation — same resilience model as the mermaid re-scan.

export type FollowUpAnchor = {
  // The originating follow-up id — used as the dedupe/cleanup key so the badge
  // survives the send transition (pending → persisted) without flicker.
  id: string
  selectedText: string
  // Display number (1-based within its batch), already stringified.
  label: string
}

const ANCHOR_CLASS = 'awog-fu-anchor'

const makeBadge = (anchor: FollowUpAnchor): HTMLElement => {
  const sup = document.createElement('sup')
  sup.className = ANCHOR_CLASS
  sup.dataset.fuAnchor = anchor.id
  sup.textContent = anchor.label
  // Reading aid for the link between the quote card and its source.
  sup.setAttribute('aria-label', `Quoted as follow-up ${anchor.label}`)
  return sup
}

// Collapse whitespace so a selection that spanned block boundaries (newlines in
// `sel.toString()` vs none in DOM textContent) still matches. We keep a position
// map from each normalized char back to its source (text node + offset) so the
// badge can be inserted right after the last matched character.
type SourcePos = { node: Text; offset: number }

const buildNormalizedIndex = (roots: HTMLElement[]): { norm: string; map: SourcePos[] } => {
  let norm = ''
  const map: SourcePos[] = []
  let prevSpace = true // treat the start as a space-run so leading whitespace is dropped
  roots.forEach((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        (node as Text).parentElement?.closest(`.${ANCHOR_CLASS}`)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    })
    let node = walker.nextNode() as Text | null
    while (node) {
      const { data } = node
      for (let i = 0; i < data.length; i += 1) {
        if (/\s/.test(data[i] as string)) {
          if (!prevSpace) {
            norm += ' '
            map.push({ node, offset: i })
            prevSpace = true
          }
        } else {
          norm += data[i]
          map.push({ node, offset: i })
          prevSpace = false
        }
      }
      node = walker.nextNode() as Text | null
    }
  })
  return { norm, map }
}

const insertBadgeAfter = (pos: SourcePos, badge: HTMLElement): void => {
  // Split the text node so everything after the matched char becomes a new node,
  // then drop the badge in front of it. splitText keeps `pos.node` as the prefix.
  const tail = pos.node.splitText(pos.offset + 1)
  tail.parentNode?.insertBefore(badge, tail)
}

// Reconcile the badges in `roots` (the DOM blocks of one agent message) with the
// desired anchor set: remove badges no longer wanted, inject the missing ones at
// their quoted text. Idempotent — safe to call on every render pass.
export const applyFollowUpAnchors = (roots: HTMLElement[], anchors: FollowUpAnchor[]): void => {
  if (!roots.length) return
  const wantById = new Map(anchors.map((a) => [a.id, a]))

  // 1. Drop stale badges + update labels on the ones we keep.
  const present = new Set<string>()
  roots.forEach((root) => {
    root.querySelectorAll<HTMLElement>(`.${ANCHOR_CLASS}`).forEach((el) => {
      const id = el.dataset.fuAnchor ?? ''
      const want = wantById.get(id)
      if (!want) {
        el.remove()
        return
      }
      if (el.textContent !== want.label) el.textContent = want.label
      present.add(id)
    })
  })

  // 2. Inject any wanted anchor not yet on screen. Iterate the deduped set (an id
  //    can briefly appear twice — pending + just-persisted during the send tick),
  //    re-resolving each match against fresh DOM so splitText insertions compose.
  const missing = [...wantById.values()].filter((a) => !present.has(a.id))
  missing.forEach((anchor) => {
    const needle = anchor.selectedText.replace(/\s+/g, ' ').trim()
    if (!needle) return
    const { norm, map } = buildNormalizedIndex(roots)
    const idx = norm.indexOf(needle)
    if (idx < 0) return // can't locate (e.g. selection crossed a step cluster) — skip
    const endPos = map[idx + needle.length - 1]
    if (endPos) insertBadgeAfter(endPos, makeBadge(anchor))
  })
}
