// OpenAI Codex (ChatGPT subscription) plan usage. Unlike Anthropic, Codex has no
// GET usage endpoint — the Codex Responses API returns rate-limit info in HTTP
// response headers (x-codex-<bucket>-used-percent, + window/reset variants), which
// codex-rs parses into a RateLimitSnapshot (primary = 5h window, secondary = week).
//
// We can only read these from a real model call, so the runtime captures them
// passively via Pi's onResponse hook (run-stream / invoke / complete) and stores
// the latest snapshot per account here, in memory. The account.usage RPC reads it
// back. NEVER throws (a usage capture must not break a turn) and stores no secret.

import { log } from '../../util/logger.js'
import type { RateLimitType, UsageEntry } from '../anthropic/usage.js'

// Header name → bucket id, e.g. "x-codex-primary-used-percent" → "primary".
const USED_PERCENT_RE = /^x-codex-([a-z0-9_]+)-used-percent$/

interface CodexBucket {
  usedPercent: number
  resetsInSeconds?: number
}

interface CodexSnapshot {
  buckets: Record<string, CodexBucket>
  capturedAt: number
}

// Per-account latest snapshot. In-memory: lost on restart, refilled on next turn.
const store = new Map<string, CodexSnapshot>()

// Only primary/secondary map to the shared UsageEntry buckets; others are ignored.
const BUCKET_TO_TYPE: Record<string, RateLimitType> = {
  primary: 'five_hour',
  secondary: 'seven_day',
}

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

// Capture Codex rate-limit headers from a model response. No-op (and never throws)
// when the response carries no x-codex-* headers — safe to call for any provider.
export function recordCodexUsageFromHeaders(
  accountId: string,
  headers: Record<string, string>,
): void {
  try {
    const h: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v

    const buckets: Record<string, CodexBucket> = {}
    for (const [key, val] of Object.entries(h)) {
      const match = USED_PERCENT_RE.exec(key)
      if (!match) continue
      const id = match[1]!
      const usedPercent = num(val)
      if (usedPercent === undefined) continue
      // Reset window header name varies across backend revisions — try both.
      const resetsInSeconds = num(h[`x-codex-${id}-reset-after-seconds`] ?? h[`x-codex-${id}-resets-in-seconds`])
      buckets[id] = { usedPercent, ...(resetsInSeconds !== undefined ? { resetsInSeconds } : {}) }
    }
    if (!Object.keys(buckets).length) return // not a Codex response
    store.set(accountId, { buckets, capturedAt: Date.now() })
    // VERIFY (temporary): log the x-codex-* header NAMES only (no values/secrets)
    // so the exact window/reset header names can be confirmed in the field. Remove
    // once parsing is verified against a real response.
    log.info('codex usage captured', {
      headerNames: Object.keys(h).filter((k) => k.startsWith('x-codex-')),
      buckets: Object.keys(buckets),
    })
  } catch {
    // A usage-capture hook must never break the turn.
  }
}

function statusFor(utilization: number): UsageEntry['status'] {
  return utilization >= 1 ? 'rejected' : utilization >= 0.9 ? 'allowed_warning' : 'allowed'
}

// The latest captured usage for a Codex account, mapped to the shared UsageEntry
// shape the UI already renders. null = nothing captured yet (no turn run).
export function getCodexUsage(accountId: string): { usage: UsageEntry[]; cachedAt: number } | null {
  const snap = store.get(accountId)
  if (!snap) return null
  const usage: UsageEntry[] = []
  for (const [id, bucket] of Object.entries(snap.buckets)) {
    const type = BUCKET_TO_TYPE[id]
    if (!type) continue
    const utilization = Math.min(1, Math.max(0, bucket.usedPercent / 100))
    const entry: UsageEntry = { rateLimitType: type, utilization, status: statusFor(utilization) }
    if (bucket.resetsInSeconds !== undefined) {
      entry.resetsAt = snap.capturedAt + bucket.resetsInSeconds * 1000
    }
    usage.push(entry)
  }
  // Stable order: 5-hour before weekly.
  usage.sort((a) => (a.rateLimitType === 'five_hour' ? -1 : 1))
  return { usage, cachedAt: snap.capturedAt }
}
