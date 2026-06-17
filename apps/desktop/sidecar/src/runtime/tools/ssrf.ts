// Shared SSRF guard for tools that fetch/navigate to a model-supplied URL
// (WebFetch, browser_tool). The URL comes from MODEL OUTPUT — L1 untrusted
// (security.md invariant #7) — so the literal-host check (ssrfCheck) is NOT
// enough: a hostname can resolve to a private IP (internal host / DNS
// rebinding). We resolve DNS and re-check every resolved address with the same
// policy. Re-run this on every redirect/navigation hop.

import { lookup } from 'node:dns/promises'
import { ssrfCheck, blockedHostReason } from '../../mcp/http-client.js'

export { ssrfCheck, blockedHostReason }

// Validate a URL against the SSRF policy, including DNS resolution. Throws with a
// human-readable reason on any violation; returns the parsed URL when allowed.
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  const check = ssrfCheck(rawUrl)
  if (!check.ok) throw new Error(`blocked URL — ${check.reason}`)
  const url = new URL(rawUrl)
  let resolved: { address: string }[]
  try {
    resolved = await lookup(url.hostname, { all: true })
  } catch {
    throw new Error(`cannot resolve host ${url.hostname}`)
  }
  for (const { address } of resolved) {
    const reason = blockedHostReason(address)
    if (reason) throw new Error(`blocked URL — ${url.hostname} resolves to ${reason}`)
  }
  return url
}
