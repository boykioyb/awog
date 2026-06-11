import { setMaxListeners } from 'node:events'

// A "turn" AbortSignal — one per chat send (sessions.send-message) and one per
// task node run (tasks/engine) — is a deliberate fan-out hub, not a
// single-owner emitter. Within ONE turn it is observed by many transient
// consumers at once: undici adds an abort listener per LLM HTTP request, every
// parallel tool call in a batch attaches its own, and every subagent reuses the
// PARENT turn signal (see runtime/tools/task-tool.ts) rather than minting a new
// one. Node caps EventTarget listeners at 10 to catch accidental leaks on
// long-lived emitters; that heuristic is simply wrong for this signal, so a busy
// turn trips `MaxListenersExceededWarning` even when every consumer detaches
// cleanly (see the bash/mcp tools, which do).
//
// The signal is turn-scoped — it is dropped when the turn settles — so removing
// the cap cannot grow an unbounded process-wide listener leak. We disable the
// cap on THIS signal only; a bare `setMaxListeners(0)` would mute the warning
// for every EventTarget in the process and hide real leaks elsewhere.
export function liftTurnSignalListenerCap(signal: AbortSignal): void {
  setMaxListeners(0, signal)
}
