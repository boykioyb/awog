// Permission-prompt parking. canUseTool emits a session.permission-request
// notification to the UI and parks a Promise here keyed by requestId. The
// sessions.permission RPC resolves it with the user's choice. If the chat is
// aborted while a prompt is open, rejectPermissionRequest unwinds it cleanly.

import type { PermissionResult, PermissionUpdate } from '../runtime/permission-types.js'

interface ParkedRequest {
  resolve: (result: PermissionResult) => void
  reject: (err: Error) => void
  // Suggestions captured at park time. When the user chooses "always allow"
  // we hand these back as `updatedPermissions` so they are added to the
  // session-scoped allowlist (destination: 'session').
  suggestions: PermissionUpdate[]
}

const PENDING = new Map<string, ParkedRequest>()

export function parkPermissionRequest(
  requestId: string,
  suggestions: PermissionUpdate[],
): Promise<PermissionResult> {
  return new Promise<PermissionResult>((resolve, reject) => {
    PENDING.set(requestId, { resolve, reject, suggestions })
  })
}

export function resolvePermissionRequest(
  requestId: string,
  result: PermissionResult,
): boolean {
  const parked = PENDING.get(requestId)
  if (!parked) return false
  PENDING.delete(requestId)
  parked.resolve(result)
  return true
}

export function getPermissionSuggestions(requestId: string): PermissionUpdate[] | null {
  const parked = PENDING.get(requestId)
  return parked ? parked.suggestions : null
}

export function rejectPermissionRequest(requestId: string, message: string): boolean {
  const parked = PENDING.get(requestId)
  if (!parked) return false
  PENDING.delete(requestId)
  // Resolve as deny rather than reject so the canUseTool contract (must return
  // PermissionResult) is honoured. The chat is already being aborted by the
  // AbortController; this is just cleanup.
  parked.resolve({ behavior: 'deny', message })
  return true
}

// ─── Session-scoped "always allow" allowlist ────────────────────────────────
// When the user picks "Always allow" for a tool, that tool stops prompting for
// the rest of the SESSION (sidecar process lifetime — resume rebuilds context
// from JSONL per turn, so there is no persisted runtime object to hang this on).
// Keyed by sessionId → set of tool names. Granularity is per-tool-name, matching
// AWOG's existing allowlist convention (skill.alwaysAllow) and keeping
// PermissionUpdate opaque (runtime/permission.ts keys off toolName, not the rule
// body). Cleared on session delete; never written to disk.
const SESSION_ALLOWLIST = new Map<string, Set<string>>()

export function allowSessionTool(sessionId: string, toolName: string): void {
  let allowed = SESSION_ALLOWLIST.get(sessionId)
  if (!allowed) {
    allowed = new Set<string>()
    SESSION_ALLOWLIST.set(sessionId, allowed)
  }
  allowed.add(toolName)
}

export function isSessionToolAllowed(sessionId: string, toolName: string): boolean {
  return SESSION_ALLOWLIST.get(sessionId)?.has(toolName) ?? false
}

export function clearSessionPermissions(sessionId: string): void {
  SESSION_ALLOWLIST.delete(sessionId)
}
