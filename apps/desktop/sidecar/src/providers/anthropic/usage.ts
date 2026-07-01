// Undocumented Anthropic OAuth endpoints that surface Claude Pro/Max plan
// usage. Reverse-engineered from boykioyb/crab-pal (Apache-2.0). Headers
// required: Authorization Bearer + anthropic-beta + User-Agent.
//
// /api/oauth/profile  → email, org, subscription tier
// /api/oauth/usage    → 5-hour + weekly rate-limit buckets
//
// Both are aggressively rate-limited by claude.ai; callers must cache.

import { REQUIRED_HEADERS, ANTHROPIC_API_HEADERS } from '../../auth/anthropic-oauth.js'

const ANTHROPIC_API_BASE = 'https://api.anthropic.com'

function buildHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'anthropic-beta': ANTHROPIC_API_HEADERS.ANTHROPIC_BETA_OAUTH,
    ...REQUIRED_HEADERS,
  }
}

export interface ClaudeProfile {
  email?: string
  displayName?: string
  accountUuid?: string
  organizationName?: string
  organizationUuid?: string
  subscriptionType?: string
  rateLimitTier?: string
  billingType?: string
  hasExtraUsageEnabled?: boolean
}

export type RateLimitType =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  | 'overage'

export interface UsageEntry {
  rateLimitType: RateLimitType
  utilization: number // 0..1
  resetsAt?: number // ms epoch
  status: 'allowed' | 'allowed_warning' | 'rejected'
}

// A non-OK response from the usage endpoint. Carries the HTTP status so callers
// can tell a transient 429 (claude.ai rate-limits this endpoint hard) apart from
// a real failure — and, crucially, from "this account has no usage surface".
// Swallowing the status (the old `if (!res.ok) return []`) made the UI card
// silently vanish on a forced refresh, indistinguishable from an empty account.
export class UsageFetchError extends Error {
  constructor(readonly status: number) {
    super(`usage endpoint returned ${status}`)
    this.name = 'UsageFetchError'
  }
}

interface ProfileResponseShape {
  account?: {
    email?: string
    display_name?: string
    full_name?: string
    uuid?: string
  }
  organization?: {
    uuid?: string
    name?: string
    organization_type?: string
    rate_limit_tier?: string
    billing_type?: string
    has_extra_usage_enabled?: boolean
  }
}

interface UsageBucketShape {
  utilization?: number
  resets_at?: string | null
}

const SUBSCRIPTION_MAP: Record<string, string> = {
  claude_max: 'max',
  claude_pro: 'pro',
  claude_enterprise: 'enterprise',
  claude_team: 'team',
}

export async function fetchClaudeProfile(accessToken: string): Promise<ClaudeProfile | null> {
  const res = await fetch(`${ANTHROPIC_API_BASE}/api/oauth/profile`, {
    method: 'GET',
    headers: buildHeaders(accessToken),
  })
  if (!res.ok) return null
  const data = (await res.json()) as ProfileResponseShape
  const orgType = data.organization?.organization_type
  const profile: ClaudeProfile = {}
  if (data.account?.email) profile.email = data.account.email
  const displayName = data.account?.display_name ?? data.account?.full_name
  if (displayName) profile.displayName = displayName
  if (data.account?.uuid) profile.accountUuid = data.account.uuid
  if (data.organization?.name) profile.organizationName = data.organization.name
  if (data.organization?.uuid) profile.organizationUuid = data.organization.uuid
  const sub = orgType ? (SUBSCRIPTION_MAP[orgType] ?? orgType) : undefined
  if (sub) profile.subscriptionType = sub
  if (data.organization?.rate_limit_tier) profile.rateLimitTier = data.organization.rate_limit_tier
  if (data.organization?.billing_type) profile.billingType = data.organization.billing_type
  if (typeof data.organization?.has_extra_usage_enabled === 'boolean') {
    profile.hasExtraUsageEnabled = data.organization.has_extra_usage_enabled
  }
  return profile
}

const BUCKET_TYPES: RateLimitType[] = [
  'five_hour',
  'seven_day',
  'seven_day_opus',
  'seven_day_sonnet',
  'overage',
]

export async function fetchClaudeUsage(accessToken: string): Promise<UsageEntry[]> {
  const res = await fetch(`${ANTHROPIC_API_BASE}/api/oauth/usage`, {
    method: 'GET',
    headers: buildHeaders(accessToken),
  })
  // Fail fast on non-OK: throw so the caller surfaces "temporarily unavailable"
  // instead of returning [] (which the UI reads as "no quota" and hides the card).
  if (!res.ok) throw new UsageFetchError(res.status)
  const data = (await res.json()) as Partial<Record<RateLimitType, UsageBucketShape | null>>
  const out: UsageEntry[] = []
  for (const type of BUCKET_TYPES) {
    const bucket = data[type]
    if (!bucket) continue
    // The endpoint reports utilization as a percentage (0-100): 1 = 1%,
    // 100 = 100%. Normalise to a 0..1 ratio (the UI multiplies back by 100).
    // The old `raw > 1 ? raw / 100 : raw` heuristic mis-read any bucket ≤ 1% as
    // a full ratio (1 → 100%), so a 1% session window showed as 100%.
    const raw = typeof bucket.utilization === 'number' ? bucket.utilization : 0
    const utilization = Math.min(1, Math.max(0, raw / 100))
    const status: UsageEntry['status'] =
      utilization >= 1 ? 'rejected' : utilization >= 0.9 ? 'allowed_warning' : 'allowed'
    const entry: UsageEntry = { rateLimitType: type, utilization, status }
    if (bucket.resets_at) entry.resetsAt = new Date(bucket.resets_at).getTime()
    out.push(entry)
  }
  return out
}
