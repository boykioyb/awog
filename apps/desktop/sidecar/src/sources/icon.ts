// Source icon resolution (ADR 0060, UI-parity area 1 — Craft's source-avatar).
// Resolves a source's icon into a renderable form for the UI, following the same
// priority Craft uses:
//
//   emoji > local file > downloaded config.icon URL > favicon-from-provider-domain
//         > (nothing → the UI falls back to a type/provider glyph)
//
// A URL icon is DOWNLOADED (SSRF-guarded, https-only, size-capped, timed out) and
// cached to sources/<slug>/icon.<ext> so subsequent resolves hit the local file
// (idempotent — a cached file short-circuits the download). Favicons are fetched
// from Google's favicon service for a known provider domain (or the host of the
// mcp.url / api.baseUrl) and cached the same way.
//
// Security (invariant #7): every network fetch is https-only + private-IP blocked
// (reusing mcp/http-client ssrfCheck), size-capped, and time-boxed. Redirects are
// followed manually with the SAME guard re-applied at each hop. This function
// NEVER throws — any failure resolves to { kind: 'none' }.

import { extname } from 'node:path'
import { log } from '../util/logger.js'
import { ssrfCheck } from '../mcp/http-client.js'
import {
  ICON_MAX_BYTES,
  loadSource,
  readSourceIconDataUri,
  writeSourceIcon,
  type IconExt,
} from './store.js'
import type { SourceConfig } from '../types/shared.js'

// The renderable form returned to the UI. `dataUri` carries a `data:<mime>;base64`
// string (CSP-safe, never a remote src); `emoji` a single glyph; `none` tells the
// UI to draw the lucide type/provider fallback.
export type ResolvedSourceIcon =
  | { kind: 'emoji'; value: string }
  | { kind: 'dataUri'; value: string }
  | { kind: 'none' }

const FETCH_TIMEOUT_MS = 8_000
const MAX_REDIRECTS = 3

// Built-in provider → canonical domain map for favicon resolution (a stdio MCP
// server has no URL, and many providers' service URLs differ from their brand
// domain). Mirrors Craft's STATIC_PROVIDER_DOMAINS, trimmed to the providers
// AWOG ships presets/mocks for. Extend here as new providers land.
const PROVIDER_DOMAINS: Record<string, string> = {
  github: 'github.com',
  linear: 'linear.app',
  notion: 'notion.so',
  slack: 'slack.com',
  google: 'google.com',
  gmail: 'google.com',
  'google-calendar': 'calendar.google.com',
  calendar: 'calendar.google.com',
  'google-drive': 'drive.google.com',
  drive: 'drive.google.com',
  exa: 'exa.ai',
  brave: 'brave.com',
  openai: 'openai.com',
  anthropic: 'anthropic.com',
  atlassian: 'atlassian.com',
  jira: 'atlassian.com',
  figma: 'figma.com',
  sentry: 'sentry.io',
  stripe: 'stripe.com',
}

// content-type → icon extension (used to name the cached file).
const MIME_EXT: Record<string, IconExt> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/ico': 'ico',
}

// URL pathname extension → icon extension (fallback when content-type is absent).
const URL_EXT: Record<string, IconExt> = {
  '.svg': 'svg',
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.webp': 'webp',
  '.gif': 'gif',
  '.ico': 'ico',
}

// A config.icon value is an emoji when it is a short non-empty string that is not
// a URL / path / data-uri. Mirrors SourceAvatar's client-side heuristic so the
// server and client agree on what counts as an emoji icon.
function isEmojiIcon(icon: string): boolean {
  return icon.length <= 8 && !/^(https?:|\/|\.|data:)/i.test(icon)
}

// https-only SSRF guard: reuse the shared literal-hostname check, then reject
// anything that is not https (icons are always served over https).
function httpsGuard(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  return ssrfCheck(url).ok
}

// Strip a leading service subdomain (api./www./mcp.) so `mcp.linear.app` resolves
// the same favicon as `linear.app`. Best-effort; leaves multi-label hosts intact.
function hostForFavicon(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return host.replace(/^(api|www|mcp)\./, '')
  } catch {
    return null
  }
}

// Resolve the domain whose favicon best represents this source: a known provider
// mapping wins; else the host of the source's service URL. Returns null when
// neither is available (a nameless stdio server → no favicon, glyph instead).
function faviconDomain(source: SourceConfig): string | null {
  const provider = source.provider?.toLowerCase()
  if (provider && PROVIDER_DOMAINS[provider]) return PROVIDER_DOMAINS[provider]
  const url =
    source.type === 'mcp' ? source.mcp.url : source.type === 'api' ? source.api.baseUrl : undefined
  if (url) return hostForFavicon(url)
  return null
}

// Read a fetch Response body with a hard byte cap so a lying/streaming server
// cannot exhaust memory. Returns null past the cap.
async function readBounded(res: Response): Promise<Buffer | null> {
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- sequential stream reads by design
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > ICON_MAX_BYTES) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

// Fetch an https image with SSRF/https guard, size cap, timeout, and manual
// redirect following (guard re-applied at every hop). Returns the bytes + the
// resolved icon extension, or null on any failure. Never throws.
async function fetchImage(
  url: string,
  hopsLeft = MAX_REDIRECTS,
): Promise<{ data: Buffer; ext: IconExt } | null> {
  if (!httpsGuard(url)) {
    log.warn('sources: icon fetch blocked by SSRF/https guard', { url })
    return null
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { Accept: 'image/*', 'User-Agent': 'AWOG-icon-fetch' },
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      await res.body?.cancel().catch(() => {})
      if (!loc || hopsLeft <= 0) return null
      clearTimeout(timer)
      return fetchImage(new URL(loc, url).toString(), hopsLeft - 1)
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return null
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    const data = await readBounded(res)
    if (!data || data.byteLength === 0) return null
    const ext = MIME_EXT[contentType ?? ''] ?? URL_EXT[extname(new URL(url).pathname).toLowerCase()]
    if (!ext) {
      log.warn('sources: icon has unrecognized content-type', { url, contentType })
      return null
    }
    return { data, ext }
  } catch (err) {
    log.warn('sources: icon fetch failed', {
      url,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Download + cache an icon from `url` into sources/<slug>/, then return it as a
// data URI (read back through the store so ext→mime stays single-sourced).
// Returns null on any failure (guard/timeout/size/unknown type).
async function downloadAndCache(slug: string, url: string): Promise<string | null> {
  const fetched = await fetchImage(url)
  if (!fetched) return null
  try {
    await writeSourceIcon(slug, fetched.ext, fetched.data)
  } catch (err) {
    log.warn('sources: failed to cache icon', {
      slug,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
  return readSourceIconDataUri(slug)
}

// Resolve a source's icon (see file header for the priority order). Never throws.
export async function resolveSourceIcon(slug: string): Promise<ResolvedSourceIcon> {
  let source: SourceConfig | null
  try {
    source = await loadSource(slug)
  } catch {
    return { kind: 'none' }
  }
  if (!source) return { kind: 'none' }

  const iconVal = source.icon?.trim()

  // 1. Emoji config.icon — rendered as text, no fetch.
  if (iconVal && isEmojiIcon(iconVal)) return { kind: 'emoji', value: iconVal }

  // 2. Local file (includes a previously downloaded URL / cached favicon).
  try {
    const local = await readSourceIconDataUri(slug)
    if (local) return { kind: 'dataUri', value: local }
  } catch (err) {
    log.warn('sources: failed to read local icon', {
      slug,
      err: err instanceof Error ? err.message : String(err),
    })
  }

  // 3. config.icon is an https URL — download + cache.
  if (iconVal && /^https:\/\//i.test(iconVal)) {
    const uri = await downloadAndCache(slug, iconVal)
    if (uri) return { kind: 'dataUri', value: uri }
  }

  // 4. Favicon from the provider domain / service host.
  const domain = faviconDomain(source)
  if (domain) {
    const favUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
    const uri = await downloadAndCache(slug, favUrl)
    if (uri) return { kind: 'dataUri', value: uri }
  }

  // 5. Nothing resolvable — the UI draws the type/provider glyph.
  return { kind: 'none' }
}
