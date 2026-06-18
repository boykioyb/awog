// Context-compaction cut-point logic (ADR 0047). Shared by the manual `/compact`
// RPC and the future auto-compact path. We re-summarise from the raw transcript
// (the JSONL is the source of truth — ADR 0029), so this only decides WHERE to
// cut: keep the most recent turns verbatim, summarise everything before.
//
// We deliberately do NOT use Pi's `compact()` / `prepareCompaction()` /
// `findCutPoint()` — those operate on Pi's `SessionTreeEntry[]` session tree,
// which AWOG doesn't keep (it rebuilds context from JSONL each turn). We reuse
// the *primitives* instead: the `keepRecentTokens` budget + the coarse chars/4
// token heuristic, matching the UI context-usage estimate.

import type { SessionMessage } from '../types/shared.js'

// Approx tokens for one message — chars/4, matching the UI hint. Coarse is fine:
// the cut only needs to land roughly at `keepRecentTokens`, and we snap it to a
// turn boundary anyway. Text-based attachments (pasted files) count toward the
// turn size via their `preview`; images are ignored (their cost isn't textual).
function estimateMessageTokens(m: SessionMessage): number {
  const textLen = (m.text ?? '').length
  const attachLen = (m.attachments ?? []).reduce((acc, a) => acc + (a.preview?.length ?? 0), 0)
  return Math.ceil((textLen + attachLen) / 4)
}

export interface CutPoint {
  // Transcript prefix to summarise (raw messages before the cut).
  toSummarize: SessionMessage[]
  // Id of the first message KEPT verbatim — the checkpoint's firstKeptMessageId.
  // The UI anchors the summary marker immediately before this message.
  firstKeptMessageId: string
  // Estimated tokens of the whole transcript before compaction (marker hint).
  tokensBefore: number
}

// Decide where to cut: keep ~`keepRecentTokens` of the most recent turns
// verbatim and summarise everything before, snapping the cut forward to a
// user-message boundary so a user→assistant turn is never split. Returns null
// when there is nothing worth summarising — the transcript already fits the
// recent budget, or the cut would leave an empty prefix — so the caller skips
// compaction (this is what prevents a no-op re-compact loop).
export function computeCutPoint(
  messages: SessionMessage[],
  keepRecentTokens: number,
): CutPoint | null {
  // Need at least a turn to summarise plus a turn to keep.
  if (messages.length < 2) return null

  const tokensBefore = messages.reduce((acc, m) => acc + estimateMessageTokens(m), 0)

  // Walk from the end accumulating the recent tail; `cut` is the index of the
  // first KEPT message (exclusive end of the summarised prefix). `keepRecentTokens`
  // = 0 (manual /compact) keeps only the last turn; a larger budget (auto) keeps
  // a healthy recent window.
  let acc = 0
  let cut = messages.length - 1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    acc += estimateMessageTokens(messages[i]!)
    cut = i
    if (acc >= keepRecentTokens) break
  }
  // Whole transcript fits the recent budget → nothing to summarise.
  if (cut <= 0) return null

  // Snap the cut to a user-message boundary so a user→assistant turn is never
  // split. Prefer the next user message at/after the cut; if none (the tail has
  // no further user turn, e.g. keepRecent=0 landing on the trailing assistant),
  // fall back to the last user message BEFORE the cut so we keep that whole turn.
  let snapped = -1
  for (let i = cut; i < messages.length; i += 1) {
    if (messages[i]!.role === 'user') {
      snapped = i
      break
    }
  }
  if (snapped < 0) {
    for (let i = cut - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === 'user') {
        snapped = i
        break
      }
    }
  }
  // No user boundary that leaves a non-empty prefix → nothing safe to compact.
  if (snapped <= 0 || snapped >= messages.length) return null

  const toSummarize = messages.slice(0, snapped)
  if (toSummarize.length === 0) return null

  return {
    toSummarize,
    firstKeptMessageId: messages[snapped]!.id,
    tokensBefore,
  }
}
