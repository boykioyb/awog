// The SEARCHABLE SURFACE of a transcript message (find-in-session §7.6): the prose a
// reader would recognise as "what was said" — the user's text, a system divider, and the
// assistant's text blocks. Tool steps, their details (diff / file / terminal), thinking,
// plan / question / permission / steer / error cards are deliberately OUT: they live
// inside collapsed activity sections, so matching them would report hits the reader
// cannot see. That exclusion is final (spec §16 "Out of scope").
//
// Data layer only — no DOM. `useSessionFind` searches THIS (the whole session, including
// turns the transcript hasn't mounted) to decide `n/N`; highlighting a mounted message is
// a separate, best-effort step.
import type { SessionMessage } from '~/composables/useSessionsData'

// `segIndex` identifies the segment within its message: the assistant block index, or 0
// for the single text of a user / system message. `text` is already normalized.
export type SearchableSegment = { segIndex: number; text: string }

// Same normalization `buildTextIndex` applies to rendered DOM text (whitespace runs
// collapse to one space, ends trimmed) plus NFC so composed and decomposed Vietnamese
// compare equal. Applied to BOTH haystack and needle — never fold diacritics: "phan tich"
// must not match "phân tích".
export function normalizeSearchText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().normalize('NFC')
}

export function searchableSegments(m: SessionMessage): SearchableSegment[] {
  if (m.role === 'assistant') {
    const out: SearchableSegment[] = []
    m.blocks.forEach((b, segIndex) => {
      if (b.kind !== 'text') return
      const text = normalizeSearchText(b.text)
      if (text) out.push({ segIndex, text })
    })
    return out
  }
  const text = normalizeSearchText(m.text)
  return text ? [{ segIndex: 0, text }] : []
}
