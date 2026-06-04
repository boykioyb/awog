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
  if (!res.ok) return []
  const data = (await res.json()) as Partial<Record<RateLimitType, UsageBucketShape | null>>
  const out: UsageEntry[] = []
  for (const type of BUCKET_TYPES) {
    const bucket = data[type]
    if (!bucket) continue
    const raw = typeof bucket.utilization === 'number' ? bucket.utilization : 0
    // API returns percentage (0-100) sometimes, ratio (0-1) other times.
    const utilization = raw > 1 ? raw / 100 : raw
    const status: UsageEntry['status'] =
      utilization >= 1 ? 'rejected' : utilization >= 0.9 ? 'allowed_warning' : 'allowed'
    const entry: UsageEntry = { rateLimitType: type, utilization, status }
    if (bucket.resets_at) entry.resetsAt = new Date(bucket.resets_at).getTime()
    out.push(entry)
  }
  return out
}
