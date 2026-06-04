// HTTP transport for MCP servers. JSON-RPC 2.0 over POST per the MCP HTTP
// transport spec. Mirrors `StdioMcpClient` API so `McpManager` can branch on
// transport without much else changing.
//
// Security:
//  - SSRF guard: reject private / loopback / link-local IP addresses before
//    making the request. User-pasted URL → L1 untrusted input (see
//    `.claude/rules/security.md` invariant #7).
//  - Headers are passed as-is. Secret expansion happens upstream (pha 2 B2
//    keychain — for now plaintext token in the JSON config is what we have).

import { log } from '../util/logger.js'

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

const PRIVATE_IP_PATTERNS = [
  /^127\./, // 127.0.0.0/8 loopback
  /^10\./, // 10.0.0.0/8 private
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 private
  /^192\.168\./, // 192.168.0.0/16 private
  /^169\.254\./, // 169.254.0.0/16 link-local
  /^0\./, // 0.0.0.0/8 reserved
] as const

const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1', '0:0:0:0:0:0:0:1'])

export interface SsrfGuardResult {
  ok: boolean
  reason?: string
}

// Lightweight SSRF check. Doesn't do DNS resolution (would slow down every
// call); relies on the URL.hostname being either a literal IP or a hostname.
// Pha 2 acceptable trade-off: a malicious DNS record that resolves to a
// private IP would slip through, but the user is the only one who can edit
// MCP server configs (no UI surface for arbitrary URL injection) so the
// blast radius is low.
export function ssrfCheck(rawUrl: string): SsrfGuardResult {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `protocol ${url.protocol} not allowed (https/http only)` }
  }
  const host = url.hostname.toLowerCase()
  if (LOOPBACK_HOSTNAMES.has(host)) {
    return { ok: false, reason: 'loopback host not allowed' }
  }
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(host)) {
      return { ok: false, reason: `private/loopback IP ${host} not allowed` }
    }
  }
  // IPv6: reject any address starting with fc/fd (ULA) or fe80 (link-local).
  if (host.includes(':')) {
    if (/^fc[0-9a-f]{2}:/i.test(host) || /^fd[0-9a-f]{2}:/i.test(host)) {
      return { ok: false, reason: `IPv6 ULA ${host} not allowed` }
    }
    if (/^fe80:/i.test(host)) {
      return { ok: false, reason: `IPv6 link-local ${host} not allowed` }
    }
  }
  return { ok: true }
}

export class HttpMcpClient {
  private nextId = 1

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  // JSON-RPC notification — fire-and-forget, no id. Used for
  // `notifications/initialized` after handshake.
  async notify(method: string, params: unknown): Promise<void> {
    await this.send({ jsonrpc: '2.0', method, params })
  }

  // JSON-RPC request — expects a response. Throws on transport error,
  // non-200, or JSON-RPC error result.
  async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId
    this.nextId += 1
    const body = { jsonrpc: '2.0' as const, id, method, params }
    const res = await this.send(body, timeoutMs)
    if (!res) throw new Error(`MCP http: empty response for ${method}`)
    if (res.error) {
      throw new Error(`MCP error ${res.error.code}: ${res.error.message}`)
    }
    return res.result
  }

  private async send(
    body: object,
    timeoutMs = 30_000,
  ): Promise<JsonRpcResponse | undefined> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
      }
      // Notifications return no body; requests return either JSON or SSE-wrapped
      // JSON (Streamable HTTP transport). Detect by content-type.
      if ('id' in body) {
        const ct = res.headers.get('content-type') ?? ''
        if (ct.includes('text/event-stream')) {
          return parseSseResponse(await res.text())
        }
        if (ct.includes('application/json')) {
          return (await res.json()) as JsonRpcResponse
        }
        // Best-effort fallback.
        const raw = await res.text()
        try {
          return JSON.parse(raw) as JsonRpcResponse
        } catch {
          throw new Error(`unexpected content-type ${ct}`)
        }
      }
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }
}

// Parse a Streamable HTTP / SSE response — we only care about the first
// `data:` event (the response to our single request). Subsequent events would
// be progress notifications which pha 1 ignores.
function parseSseResponse(raw: string): JsonRpcResponse | undefined {
  for (const block of raw.split(/\n\n/)) {
    for (const line of block.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice('data:'.length).trim()
      if (!payload) continue
      try {
        return JSON.parse(payload) as JsonRpcResponse
      } catch (err) {
        log.warn('mcp http: bad SSE payload', {
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  return undefined
}
