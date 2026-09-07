// Permission-prompt parking. canUseTool emits a session.permission-request
// notification to the UI and parks a Promise here keyed by requestId. The
// sessions.permission RPC resolves it with the user's choice. If the chat is
// aborted while a prompt is open, rejectPermissionRequest unwinds it cleanly.

import type { PermissionResult, PermissionUpdate } from '../runtime/permission-types.js'
import { clearSessionRules, forgetSessionProjectPath } from './permission-rules.js'

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

// ─── Session-scoped SSH allowance ───────────────────────────────────────────
// NOT the general "always allow" path — that one moved to permission-rules.ts
// (ADR 0080: a remembered allowance keys off the RULE, i.e. the command/path,
// never off the bare tool name).
//
// What is left here is the SSH gate's own allowance (ADR 0064 F2): sshApprovalMode
// 'session' remembers the FIRST approval per (session, host, tool) under an opaque
// key like `ssh_exec@host`. It is deliberately separate: the SSH gate is driven by
// sshApprovalMode rather than the general allowlist, it is never persisted to disk,
// and its key is already content-scoped by host. Cleared on session delete.
const SESSION_SSH_ALLOWLIST = new Map<string, Set<string>>()

export function allowSessionTool(sessionId: string, rememberKey: string): void {
  let allowed = SESSION_SSH_ALLOWLIST.get(sessionId)
  if (!allowed) {
    allowed = new Set<string>()
    SESSION_SSH_ALLOWLIST.set(sessionId, allowed)
  }
  allowed.add(rememberKey)
}

export function isSessionToolAllowed(sessionId: string, rememberKey: string): boolean {
  return SESSION_SSH_ALLOWLIST.get(sessionId)?.has(rememberKey) ?? false
}

export function clearSessionPermissions(sessionId: string): void {
  SESSION_SSH_ALLOWLIST.delete(sessionId)
  clearSessionRules(sessionId)
  forgetSessionProjectPath(sessionId)
}
