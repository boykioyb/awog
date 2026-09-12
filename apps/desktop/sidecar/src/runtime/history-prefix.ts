// Re-narrate AWOG's own transcript for a runtime whose conversation store is
// empty.
//
// Both first-party harnesses keep history on THEIR side — the Claude Agent SDK in
// its session store, Codex in its thread rollout — and neither can see AWOG's
// JSONL. So the first turn against a fresh handle has to carry the conversation
// in-band; every turn after that resumes. When a compaction checkpoint is active
// (right after /compact) the block is [summary + kept turns] rather than the full
// transcript, which is what makes the fresh handle start with REDUCED context
// (ADR 0047/0058) instead of quietly undoing the compaction.
//
// Kept compact and text-only on purpose: this is orientation, not a replay. Tool
// calls, steps and attachments are not re-sent.

import type { SessionCompaction, SessionMessage } from '../types/shared.js'

export function renderHistoryPrefix(
  history: SessionMessage[],
  compaction?: SessionCompaction,
): string {
  let msgs = history
  let summaryBlock = ''
  if (compaction) {
    const idx = history.findIndex((m) => m.id === compaction.firstKeptMessageId)
    if (idx >= 0) {
      msgs = history.slice(idx)
      summaryBlock = `<summary_of_earlier_conversation>\n${compaction.summary}\n</summary_of_earlier_conversation>\n\n`
    }
  }
  const lines: string[] = []
  for (const m of msgs) {
    if (m.role === 'system') continue
    const text = (m.text ?? '').trim()
    if (!text) continue
    lines.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${text}`)
  }
  const convo =
    lines.length > 0 ? `<conversation_so_far>\n${lines.join('\n\n')}\n</conversation_so_far>` : ''
  return `${summaryBlock}${convo}`.trim()
}
