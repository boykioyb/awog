// Confabulation guard (sessions). Catches the failure where the model ENDS a
// turn claiming it performed tool-class work — delegated to a subagent, read a
// file, ran a command, reviewed code, committed — while making ZERO tool calls
// that turn, then fabricates the outcome (an "APPROVED" review, a fixed-bug
// summary, a results table).
//
// Observed repeatedly in real sessions: once a transcript holds a few genuine
// "delegate → summary" exchanges, the model auto-completes the summary without
// doing the work, and each fabricated summary it leaves behind reinforces the
// pattern on the next turn. VERIFY_PROMPT (prompts.ts) alone does not stop it —
// a soft directive loses to a strong in-context behavioural pattern (proven in
// session ses-mqvoiivy: the model relapsed one turn after apologising).
//
// Mechanism: wired as Pi's `getFollowUpMessages` hook in run-stream.ts — called
// exactly when the model would otherwise end its turn (no tool calls AND no
// queued steering). When the turn made no tool call AND the reply reads like an
// ungrounded action report, we inject ONE reminder so the loop continues and the
// model does the work for real in the same turn — instead of the user having to
// notice the fabrication and re-prompt.
//
// Known limitation (v1): the trigger is "ZERO tool calls in the whole turn". A
// turn that makes one real tool call (e.g. a Read) and then fabricates a
// SEPARATE subagent result is not caught. This targets the dominant pattern.

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { log } from '../util/logger.js'

// Minimum reply length before a WEAK claim marker counts — short replies
// (greetings, one-liners, clarifying questions) are never confab work-reports
// worth a re-prompt. STRONG markers bypass this (they are unambiguous).
const MIN_REPORT_CHARS = 160

// STRONG markers: unambiguous claims of having performed/dispatched work. Fire
// regardless of length. Tuned to the orchestration workflow where this bites
// hardest (subagent delegation + review verdicts) but kept generic.
const STRONG_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bsub-?agents?\b/i, // "giao cho dev subagent", "cr subagent re-review"
  /\b(APPROVED|CHANGES_NEEDED|LGTM)\b/, // review verdicts
  /\b(BLOCK|MAJOR|MINOR|NIT)-\d/, // finding ids in a fabricated review table
  /\bgiao\s+(cho|lại)\b/i, // vi: "hand (it) over to / hand back to"
]

// WEAK markers: first-person past-tense completion claims (en + vi — AWOG is
// used in Vietnamese). Deliberately NOT generic present-tense ("the function
// runs"), which appears in normal explanations and would false-positive. Require
// MIN_REPORT_CHARS so a passing mention does not trip the guard. Precision over
// recall: a missed confab costs one re-prompt; a false nudge appends an awkward
// trailing message to an otherwise-good answer.
const WEAK_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bI(?:'ve| have)?\s+(committed|fixed|created|updated|ran|executed|reviewed|verified|delegated|implemented|merged|pushed)\b/i,
  /\bđã\s+(commit|sửa|fix|tạo|cập\s*nhật|chạy|review|xác\s*minh|hoàn\s*(thành|tất)|merge|push|verify)/i,
]

// Heuristic: does this reply read like a report of tool-class work the model
// claims to have done? Pure content check — the caller supplies the
// "0 tool calls this turn" precondition.
export function looksLikeUngroundedActionReport(text: string): boolean {
  const t = text.trim()
  if (t.length === 0) return false
  if (STRONG_CLAIM_PATTERNS.some((re) => re.test(t))) return true
  if (t.length >= MIN_REPORT_CHARS && WEAK_CLAIM_PATTERNS.some((re) => re.test(t))) return true
  return false
}

// The reminder injected when the guard fires. Framed as a system directive on a
// user-role message (Pi steering/follow-up messages are user-role). It is
// ephemeral — never persisted to the session JSONL and never rendered as a user
// bubble — so resume rebuilds context without it. The last paragraph green-lights
// the false-positive case so a genuinely conversational reply ends cleanly.
export const CONFABULATION_REMINDER =
  `[system reminder] You ended your turn without making a single tool call this turn, yet your reply reads as if you performed work — delegated to a subagent, read a file, ran a command, reviewed or edited code, or committed. You did NOT do any of that: no tool was called.\n\n` +
  `Reporting the result of an action you did not actually perform is fabrication. If you intended to delegate to a subagent, you MUST call the Task tool now. If you intended to read/edit a file or run a command, call the corresponding tool now. Then report ONLY what the real tool results show — never the outcome you expected.\n\n` +
  `If your previous reply was genuinely just conversation that required no tool — an explanation, a plan for the user to approve, or a question for the user — then simply end your turn again without restating anything.`

export interface ConfabulationFollowUpOptions {
  // Full assistant reply accumulated so far this turn.
  getReplyText: () => string
  // Cumulative count of tool calls started this turn.
  getTurnToolCalls: () => number
  // Skip when the turn had no tools to call (nudging is pointless).
  toolsAvailable: boolean
  sessionId: string
}

// Build the `getFollowUpMessages` callback. Fires AT MOST ONCE per turn (a
// second 0-tool-call ending after the nudge is let through, to avoid loops and
// respect a model that legitimately has nothing to call). Contract: must not
// throw — a guard failure should never break the turn.
export function makeConfabulationFollowUp(
  opts: ConfabulationFollowUpOptions,
): () => Promise<AgentMessage[]> {
  let nudged = false
  return async (): Promise<AgentMessage[]> => {
    try {
      if (nudged || !opts.toolsAvailable) return []
      if (opts.getTurnToolCalls() > 0) return []
      if (!looksLikeUngroundedActionReport(opts.getReplyText())) return []
      nudged = true
      log.warn('confabulation guard: 0 tool calls but reply claims work — nudging', {
        sessionId: opts.sessionId,
      })
      return [{ role: 'user', content: CONFABULATION_REMINDER, timestamp: Date.now() }]
    } catch (err) {
      log.warn('confabulation guard failed', {
        sessionId: opts.sessionId,
        err: err instanceof Error ? err.message : String(err),
      })
      return []
    }
  }
}
