// In-memory registry of in-flight OAuth logins keyed by a flowId, so a
// long-lived `auth.startOAuthCodex` RPC can be cancelled by a separate
// `auth.cancelOAuth` RPC (the browser login blocks until the user authorizes or
// the flow is aborted). Mirrors auth/state-store.ts in spirit but holds an
// AbortController instead of a PKCE verifier.

const controllers = new Map<string, AbortController>()

export function putFlow(flowId: string, controller: AbortController): void {
  controllers.set(flowId, controller)
}

export function removeFlow(flowId: string): void {
  controllers.delete(flowId)
}

// Abort an in-flight flow. Returns true if a flow was found + aborted. The login
// promise rejects (AbortError) so the start RPC's finally cleans up the entry.
export function cancelFlow(flowId: string): boolean {
  const controller = controllers.get(flowId)
  if (!controller) return false
  controller.abort()
  return true
}
