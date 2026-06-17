// WebFetch AgentTool (ADR 0042). Replaces the earlier graceful stub: the agent
// can now fetch a public URL and read its content. The URL comes from MODEL
// OUTPUT — L1 untrusted (security.md) — so this is gated by a stronger SSRF
// guard than the MCP transport: protocol + literal-host check (ssrfCheck) AND a
// DNS resolution that re-checks every resolved IP, re-run on each redirect hop.
// Honours invariant #7 (no SSRF): private / loopback / link-local targets are
// rejected; only http/https; bounded download + output size + timeout.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { assertSafeUrl } from './ssrf.js'
import { log } from '../../util/logger.js'

const FETCH_TIMEOUT_MS = 20_000 // whole-request budget (shared across redirects)
const MAX_REDIRECTS = 5
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 // stop reading the body past 2 MB
const MAX_OUTPUT_CHARS = 50_000 // cap returned text so a page can't blow the context window

const WebFetchParams = Type.Object(
  {
    url: Type.String({ description: 'The absolute http/https URL to fetch.' }),
    // Claude Code's WebFetch uses `prompt` to summarise via a sub-model. AWOG
    // returns the (capped) page content directly for the calling model to use,
    // so we accept the field for API compatibility but don't act on it.
    prompt: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

interface WebFetchDetails {
  url: string
  status?: number
}

function textResult(text: string, details: WebFetchDetails): AgentToolResult<WebFetchDetails> {
  return { content: [{ type: 'text', text }], details }
}

// Fetch following redirects manually so the SSRF guard re-runs on every hop —
// a public URL must not be able to bounce us to an internal target.
async function fetchFollowing(
  startUrl: string,
  signal: AbortSignal,
): Promise<{ res: Response; finalUrl: string }> {
  let current = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertSafeUrl(current)
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': 'AWOG-WebFetch/1.0',
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8',
      },
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      // Drain the redirect body so the socket can be reused / freed.
      await res.body?.cancel().catch(() => {})
      if (!loc) return { res, finalUrl: current }
      current = new URL(loc, current).toString()
      continue
    }
    return { res, finalUrl: current }
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS})`)
}

// Read the response body up to a byte cap without buffering the whole stream.
async function readCapped(res: Response): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) return { text: '', truncated: false }
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    total += value.length
    if (total >= MAX_DOWNLOAD_BYTES) {
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
  }
  const buf = Buffer.concat(chunks).subarray(0, MAX_DOWNLOAD_BYTES)
  return { text: buf.toString('utf8'), truncated }
}

// Crude HTML → text. No parser dependency (ADR 0042): strip script/style/
// comments, turn block-closing tags into newlines, drop remaining tags, decode
// the few common entities, collapse whitespace.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|nav)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function createWebFetchTool(): AgentTool<typeof WebFetchParams, WebFetchDetails> {
  return {
    name: 'WebFetch',
    label: 'Fetch URL',
    description:
      'Fetch the content of a public http/https URL and return it as text (HTML is converted to plain text). Private, loopback and link-local addresses are blocked.',
    parameters: WebFetchParams,
    async execute(_id, params): Promise<AgentToolResult<WebFetchDetails>> {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
      try {
        const { res, finalUrl } = await fetchFollowing(params.url, ctrl.signal)
        if (!res.ok) {
          await res.body?.cancel().catch(() => {})
          return textResult(`Fetch failed: HTTP ${res.status} for ${finalUrl}`, {
            url: finalUrl,
            status: res.status,
          })
        }
        const contentType = res.headers.get('content-type') ?? ''
        const { text: raw, truncated: downloadTruncated } = await readCapped(res)
        let body = contentType.includes('text/html') ? htmlToText(raw) : raw
        let truncated = downloadTruncated
        if (body.length > MAX_OUTPUT_CHARS) {
          body = body.slice(0, MAX_OUTPUT_CHARS)
          truncated = true
        }
        const header = `Fetched ${finalUrl} — HTTP ${res.status}, ${contentType || 'unknown type'}\n\n`
        return textResult(header + body + (truncated ? '\n…(truncated)' : ''), {
          url: finalUrl,
          status: res.status,
        })
      } catch (err) {
        const msg =
          err instanceof Error
            ? ctrl.signal.aborted
              ? `timed out after ${FETCH_TIMEOUT_MS}ms`
              : err.message
            : String(err)
        log.warn('WebFetch failed', { url: params.url, err: msg })
        return textResult(`Could not fetch ${params.url}: ${msg}`, { url: params.url })
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
