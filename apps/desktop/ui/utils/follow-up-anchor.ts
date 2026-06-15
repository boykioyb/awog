// Follow-up anchors — a highlight over the quoted span plus a numbered superscript
// badge (①②③) injected into a rendered agent message at the spot the user quoted,
// linking it to the matching numbered quote card in their reply. Both are plain DOM
// (they live inside the v-html'd markdown, where Vue components can't), re-applied by
// SessionMessageList on every content mutation — same resilience model as the
// mermaid re-scan. The highlight background uses --awog-accent (set on the .awog-md
// root by SessionMessageItem) so it tracks the active accent color.

export type FollowUpAnchor = {
  // The originating follow-up id — used as the dedupe/cleanup key so the badge
  // survives the send transition (pending → persisted) without flicker.
  id: string
  selectedText: string
  // Display number (1-based within its batch), already stringified.
  label: string
}

const ANCHOR_CLASS = 'awog-fu-anchor'
const HIGHLIGHT_CLASS = 'awog-fu-highlight'
const FLASH_CLASS = 'awog-fu-flash'

// Scroll the rendered message body to the highlight for `id` and flash it, so a
// click on the matching quote chip jumps the reader back to where it was quoted.
// Best-effort: a quote whose source can't be located on screen (text not matched,
// or it lived in a collapsed step cluster) simply doesn't move the view.
export const revealFollowUpAnchor = (id: string): void => {
  const sel = `[data-fu-anchor="${CSS.escape(id)}"]`
  const marks = Array.from(document.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}${sel}`))
  const target = marks[0] ?? document.querySelector<HTMLElement>(`.${ANCHOR_CLASS}${sel}`)
  if (!target) return
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  marks.forEach((el) => {
    el.classList.remove(FLASH_CLASS)
    void el.offsetWidth // restart the animation if the chip is clicked repeatedly
    el.classList.add(FLASH_CLASS)
    window.setTimeout(() => el.classList.remove(FLASH_CLASS), 1200)
  })
}

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

// A run of the matched range that lives inside a single text node. Because the
// walker visits a node's characters in document order before moving on, every
// position the range maps into one node is contiguous — so the range yields at
// most one segment per node.
type Segment = { node: Text; start: number; end: number }

const collectSegments = (map: SourcePos[], from: number, toInclusive: number): Segment[] => {
  const segs: Segment[] = []
  for (let i = from; i <= toInclusive; i += 1) {
    const pos = map[i]
    if (!pos) continue
    const last = segs[segs.length - 1]
    if (last && last.node === pos.node) last.end = pos.offset + 1
    else segs.push({ node: pos.node, start: pos.offset, end: pos.offset + 1 })
  }
  return segs
}

// Wrap the quoted span in a <mark> per text node it spans. Runs AFTER the badge is
// inserted: insertBadgeAfter only splits the END node (keeping it as the prefix), so
// every segment offset stays valid. surroundContents never partially selects a
// non-text node here (each range sits inside one text node), but stays best-effort —
// a thrown range leaves the badge intact.
const highlightRange = (map: SourcePos[], from: number, toInclusive: number, id: string): void => {
  collectSegments(map, from, toInclusive).forEach((seg) => {
    try {
      const mark = document.createElement('mark')
      mark.className = HIGHLIGHT_CLASS
      mark.dataset.fuAnchor = id
      const range = document.createRange()
      range.setStart(seg.node, seg.start)
      range.setEnd(seg.node, seg.end)
      range.surroundContents(mark)
    } catch {
      // Range no longer valid (DOM shifted under us) — skip this segment.
    }
  })
}

// Unwrap a highlight: lift its children back out, drop the <mark>, then merge the
// adjacent text nodes so the next normalized-index rebuild sees contiguous text.
const unwrapHighlight = (mark: HTMLElement): void => {
  const parent = mark.parentNode
  if (!parent) return
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
  parent.removeChild(mark)
  parent.normalize()
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
    // Unwrap highlights whose anchor is gone; leave wanted ones in place. Done
    // after badge cleanup so `present` already reflects the surviving anchors.
    root.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
      if (!wantById.has(el.dataset.fuAnchor ?? '')) unwrapHighlight(el)
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
    const end = idx + needle.length - 1
    const endPos = map[end]
    if (!endPos) return
    // Badge first (splits only the end node, keeping it as the prefix), then the
    // highlight — so the segment offsets the highlight uses stay valid.
    insertBadgeAfter(endPos, makeBadge(anchor))
    highlightRange(map, idx, end, anchor.id)
  })
}
