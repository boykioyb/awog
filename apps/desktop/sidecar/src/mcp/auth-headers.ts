// Bearer-scheme normalization for MCP http/sse sources (ADR 0060).
//
// An mcp source with `authType: 'bearer'` stores just the TOKEN in its
// `Authorization` header (the UI's "Bearer / token header" mode collects a bare
// token). The scheme itself is owned here, at the single send layer, so callers
// don't have to know it: the token is emitted as `Authorization: Bearer <token>`.
//
// This is what makes the "Bearer" auth type actually send a Bearer credential —
// previously the header was forwarded verbatim, so a bare token reached the
// server without the `Bearer ` prefix and was rejected as unauthenticated.
//
// Applied AFTER `secret:` expansion (the value must be the plaintext token, not a
// keychain reference) at every place that turns a source into a live connection:
// mcpManager.test (probe), sessions.send-message + tasks/agent-context (runtime).

// Detect a value that ALREADY carries an auth scheme (`<scheme> <token>`, e.g.
// `Bearer abc`, `Basic dG9r`). A bare token is a single whitespace-free string,
// so the presence of an internal space means the caller supplied the full header
// value and we must not double-prefix it. Empty/whitespace values are left as-is.
const HAS_SCHEME_RE = /^\S+\s+\S/

// Return a copy of `headers` with the `Authorization` value prefixed by `Bearer `
// when the source uses `authType: 'bearer'` and the value is a bare token. A
// no-op for any other auth type, a missing/empty Authorization header, or a value
// that already includes a scheme (idempotent — safe to run every turn).
export function applyBearerScheme(
  authType: string | undefined,
  headers: Record<string, string>,
): Record<string, string> {
  if (authType !== 'bearer') return headers
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization')
  if (!key) return headers
  const value = headers[key]?.trim()
  if (!value || HAS_SCHEME_RE.test(value)) return headers
  return { ...headers, [key]: `Bearer ${value}` }
}
