// Permission-prompt parking. canUseTool emits a session.permission-request
// notification to the UI and parks a Promise here keyed by requestId. The
// sessions.permission RPC resolves it with the user's choice. If the chat is
// aborted while a prompt is open, rejectPermissionRequest unwinds it cleanly.

import type { PermissionResult, PermissionUpdate } from '../runtime/permission-types.js'
import { clearSessionRules } from './permission-rules.js'

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

// ─── Session-scoped allowance ───────────────────────────────────────────────
// NOT the rule path — that one lives in permission-rules.ts (ADR 0080: a rule keys
// off the COMMAND/PATH and can be written to disk at three tiers).
//
// This is what the two gates that cannot produce a rule remember instead:
//   · cổng SSH (ADR 0064 F2) — khoá `ssh_exec@host`, ghi bởi sshApprovalMode
//     'session' (lần duyệt đầu) hoặc bởi một cú bấm "Cho phép luôn";
//   · cổng hạ tầng (ADR 0088 §6) — khoá `infra:<tool>:<lớp>@<account>`, CHỈ ghi
//     bởi một cú bấm "Cho phép luôn".
// Cả hai là bộ nhớ tiến trình: không bao giờ chạm đĩa, chết cùng phiên, nên chúng
// không phải nguồn sự thật thứ hai cạnh sshApprovalMode / ma trận quyền. Khoá là
// chuỗi MỜ do chính cổng sinh ra và chỉ cổng đó đọc lại. Cleared on session delete.
const SESSION_TOOL_ALLOWLIST = new Map<string, Set<string>>()

export function allowSessionTool(sessionId: string, rememberKey: string): void {
  let allowed = SESSION_TOOL_ALLOWLIST.get(sessionId)
  if (!allowed) {
    allowed = new Set<string>()
    SESSION_TOOL_ALLOWLIST.set(sessionId, allowed)
  }
  allowed.add(rememberKey)
}

export function isSessionToolAllowed(sessionId: string, rememberKey: string): boolean {
  return SESSION_TOOL_ALLOWLIST.get(sessionId)?.has(rememberKey) ?? false
}

export function clearSessionPermissions(sessionId: string): void {
  SESSION_TOOL_ALLOWLIST.delete(sessionId)
  clearSessionRules(sessionId)
}
