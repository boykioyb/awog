// Extra-usage (overage) confirmation gate for the chat runtime.
//
// Anthropic returns unified rate-limit headers on every /v1/messages response.
// `anthropic-ratelimit-unified-representative-claim` names the bucket the request
// was charged against; when it is `overage` the request consumed PAID extra usage
// rather than the included subscription quota. On an account with extra usage
// disabled this never happens (the request is rejected with 400 before billing —
// representative-claim stays `five_hour`), so this gate is inert there. On an
// account with extra usage ENABLED the request succeeds and silently bills real
// money — this gate turns that into a one-time, per-session confirmation.
//
// Flow: on the first response that consumed overage —
//   - chat (interactive askUser): PARK the loop and ask the user to confirm.
//     "Continue" is remembered for the session; "Stop" aborts via the cancel path.
//   - headless (tasks/subagents — no askUser): FAIL CLOSED — stop the run with a
//     clear error rather than silently bill paid extra usage with nobody to approve.
//
// NOTE: the exact `representative-claim` value emitted when overage is actually
// consumed was inferred from the disabled-case headers, not verified on a live
// extra-usage-enabled account. We therefore ALSO log the unified headers whenever
// overage is in play (status !== 'rejected') so the real value can be confirmed
// and TRIGGER_CLAIM tuned if needed. Worst case the gate simply doesn't fire — it
// can never false-trigger on a normal (`five_hour`) response.

import type { AskUserQuestionFn } from './permission-types.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'

// Sessions whose user has approved extra usage for the rest of the session.
const confirmedSessions = new Set<string>()

// Drop a session's approval (call on session delete to bound the set).
export function clearOverageConfirmation(sessionId: string): void {
  confirmedSessions.delete(sessionId)
}

const TRIGGER_CLAIM = 'overage'

function header(headers: Record<string, string>, name: string): string {
  return (headers[name] ?? headers[name.toLowerCase()] ?? '').toLowerCase()
}

// Inspect a response's unified rate-limit headers; if it consumed paid overage,
// confirm with the user (chat) or warn (headless). Throws CANCELED on "Stop".
export async function confirmOverageOrStop(
  headers: Record<string, string>,
  sessionId: string,
  askUser: AskUserQuestionFn | undefined,
  signal: AbortSignal | undefined,
  abort: (() => void) | undefined,
): Promise<void> {
  const overageStatus = header(headers, 'anthropic-ratelimit-unified-overage-status')
  // Surface the raw signal whenever overage is even reachable, so the exact
  // consumed-value can be verified on an extra-usage-enabled account.
  if (overageStatus && overageStatus !== 'rejected') {
    log.warn('extra-usage signal (unified rate-limit)', {
      sessionId,
      representativeClaim: header(headers, 'anthropic-ratelimit-unified-representative-claim'),
      overageStatus,
      util5h: header(headers, 'anthropic-ratelimit-unified-5h-utilization'),
      util7d: header(headers, 'anthropic-ratelimit-unified-7d-utilization'),
    })
  }

  if (header(headers, 'anthropic-ratelimit-unified-representative-claim') !== TRIGGER_CLAIM) return
  if (confirmedSessions.has(sessionId)) return

  if (!askUser) {
    // Headless (task / subagent): cannot prompt → FAIL CLOSED. Stop the run
    // rather than silently bill paid extra usage with nobody to approve it.
    log.warn('extra usage (overage) detected in a headless run — stopping', { sessionId })
    abort?.()
    throw new Error(
      'Stopped: this request consumed paid extra usage (overage), and a headless ' +
        'run (task/subagent) cannot prompt for confirmation. Run interactively to ' +
        'approve, or disable extra usage on the account.',
    )
  }

  const answers = await askUser(
    `overage-confirm-${sessionId}`,
    [
      {
        header: 'Extra usage',
        question:
          '⚠️ This turn is consuming PAID extra usage (overage), not your included subscription quota. Continue?',
        options: [
          { label: 'Stop', description: 'Stop this turn now — no further extra-usage requests.' },
          {
            label: 'Continue',
            description: 'Allow extra usage for the rest of this session (you will be billed).',
          },
        ],
        multiSelect: false,
      },
    ],
    signal,
  )

  if (answers[0]?.selected.includes('Continue')) {
    confirmedSessions.add(sessionId)
    return
  }
  // "Stop" (or no/closed answer): abort the loop and reject via the cancel path.
  abort?.()
  throw new RpcError(-32023, 'CANCELED')
}
