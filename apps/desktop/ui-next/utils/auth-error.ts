// Auth-failure detection for RPC/model-call errors. The sidecar surfaces the
// credential resolver's failure inside the error message (e.g.
// "code_invalid: Refresh token not found or invalid"); the account-row codes
// (AUTH_EXPIRED / TOKEN_EXPIRED) cover the structured variants. Used to attach
// an "Open Settings" action to failure toasts so an expired OAuth token has a
// one-click path to re-auth instead of a dead-end message.
const AUTH_MARKERS = [
  'code_invalid',
  'AUTH_EXPIRED',
  'TOKEN_EXPIRED',
  'invalid_grant',
  'refresh token',
  'refresh_token',
  'unauthorized',
  '401',
  'authentication',
]

export function isAuthError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return AUTH_MARKERS.some((m) => msg.includes(m.toLowerCase()))
}
