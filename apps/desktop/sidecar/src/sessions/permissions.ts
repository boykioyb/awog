// Permission-prompt parking. canUseTool emits a session.permission-request
// notification to the UI and parks a Promise here keyed by requestId. The
// sessions.permission RPC resolves it with the user's choice. If the chat is
// aborted while a prompt is open, rejectPermissionRequest unwinds it cleanly.

import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'

interface ParkedRequest {
  resolve: (result: PermissionResult) => void
  reject: (err: Error) => void
  // Suggestions captured at park time. When the user chooses "always allow"
  // we hand these back as `updatedPermissions` so the SDK adds them to the
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
  // Resolve as deny rather than reject so the SDK's canUseTool contract
  // (must return PermissionResult) is honoured. The chat is already being
  // aborted by the AbortController; this is just cleanup.
  parked.resolve({ behavior: 'deny', message })
  return true
}
