// Validator for user-supplied custom LLM endpoint base URLs (ADR 0026 Phase B).
//
// NOTE: this is deliberately NOT the MCP SSRF guard (mcp/http-client.ts), which
// rejects loopback / private IPs. Local model runners (Ollama, vLLM, LM Studio)
// live precisely at http://localhost:11434 and friends, so blocking loopback
// would defeat the feature. The base URL here is L0/user-config trust — typed
// by the operator in Settings, same trust level as an MCP server config — not a
// URL coming from model output or a context provider. security.md invariant #7
// (no SSRF) targets the latter, so allowing localhost here is consistent.
//
// We still reject the obviously dangerous / malformed shapes.

import { RpcError } from '../transport/rpc.js'

// The Anthropic SDK appends `/v1/messages` to ANTHROPIC_BASE_URL, and the
// default base (https://api.anthropic.com) has NO `/v1`. Users routinely paste a
// base that already ends in `/v1` (OpenAI-style) → that yields `/v1/v1/messages`
// (404). Strip a trailing `/v1` (+ trailing slashes) so the base is the root the
// SDK expects. An Anthropic-compatible endpoint at `<root>/v1/messages` then
// resolves correctly for both runtime and the connection test.
export function normalizeAnthropicBaseURL(rawUrl: string): string {
  return rawUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '')
}

export function validateCustomEndpoint(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new RpcError(-32016, `invalid endpoint URL: ${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RpcError(-32016, `endpoint protocol ${url.protocol} not allowed (http/https only)`)
  }
  // Credentials-in-URL (http://user:pass@host) are a footgun — the key belongs
  // in the apiKey field, not the URL.
  if (url.username || url.password) {
    throw new RpcError(-32016, 'endpoint URL must not contain credentials')
  }
  // A fragment on an API base URL is always a mistake and can mask the real host.
  if (url.hash) {
    throw new RpcError(-32016, 'endpoint URL must not contain a fragment')
  }
  return url
}
