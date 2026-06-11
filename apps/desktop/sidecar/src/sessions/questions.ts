// AskUserQuestion parking — the question-tool counterpart to permissions.ts.
//
// The AskUserQuestion tool (runtime/tools/ask-user-question-tool.ts) parks a
// Promise here keyed by the tool-call id (== the step id the UI renders), while
// the question rides to the UI on the normal session.step event. The
// sessions.answerQuestion RPC resolves it with the user's chosen answers. If the
// turn is aborted while a question is open, rejectQuestionRequest unwinds it as
// an empty answer set so the tool can return a "canceled" result rather than
// hang. See docs/features/ask-user-question.md.

import type { SessionQuestionAnswer } from '../types/shared.js'

interface ParkedQuestion {
  resolve: (answers: SessionQuestionAnswer[]) => void
}

const PENDING = new Map<string, ParkedQuestion>()

export function parkQuestionRequest(requestId: string): Promise<SessionQuestionAnswer[]> {
  return new Promise<SessionQuestionAnswer[]>((resolve) => {
    PENDING.set(requestId, { resolve })
  })
}

export function resolveQuestionRequest(
  requestId: string,
  answers: SessionQuestionAnswer[],
): boolean {
  const parked = PENDING.get(requestId)
  if (!parked) return false
  PENDING.delete(requestId)
  parked.resolve(answers)
  return true
}

// Cancel an open question (turn aborted). Resolves with an empty answer set so
// the tool's execute() returns a benign "canceled" result — the AbortController
// already tears down the loop; this is just cleanup of the parked promise.
export function rejectQuestionRequest(requestId: string): boolean {
  const parked = PENDING.get(requestId)
  if (!parked) return false
  PENDING.delete(requestId)
  parked.resolve([])
  return true
}
