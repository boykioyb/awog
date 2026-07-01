// Real plan/rate-limit usage for an account (account.usage RPC → claude.ai OAuth
// endpoints for Anthropic, captured Codex headers for OpenAI). Best-effort: empty
// when the bridge is absent (browser-dev), the provider has no usage surface
// (google / API-key), or the fetch fails. The sidecar caches 60s per account, so
// `refresh()` on popover-open is cheap; `force` bypasses that cache.
import { ref, type MaybeRefOrGetter, toValue } from 'vue'
import { useSidecar } from './useSidecar'

export type RateLimitType =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  | 'overage'
export type UsageEntry = {
  rateLimitType: RateLimitType
  utilization: number // 0..1
  resetsAt?: number // ms epoch
  status?: string
}

type UsageTarget = { provider: string; accountId?: string } | null

export function useAccountUsage(target: MaybeRefOrGetter<UsageTarget>) {
  const sc = useSidecar()
  const entries = ref<UsageEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const cachedAt = ref<number | null>(null)

  async function refresh(force = false): Promise<void> {
    const t = toValue(target)
    if (!sc.available || !t) {
      entries.value = []
      return
    }
    // Usage API only exists for Anthropic (subscription) + OpenAI (Codex).
    if (t.provider !== 'anthropic' && t.provider !== 'openai') {
      entries.value = []
      error.value = null
      return
    }
    loading.value = true
    error.value = null
    try {
      const res = await sc.request<{ usage: UsageEntry[]; cachedAt: number }>('account.usage', {
        provider: t.provider,
        ...(t.accountId ? { accountId: t.accountId } : {}),
        ...(force ? { force: true } : {}),
      })
      entries.value = Array.isArray(res.usage) ? res.usage : []
      cachedAt.value = res.cachedAt ?? null
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load usage'
      // Keep the last-good entries so a transient failure (e.g. a forced refresh
      // hitting claude.ai's aggressive 429 on /api/oauth/usage) shows an error
      // note over the existing bars instead of blanking — and hiding — the card.
    } finally {
      loading.value = false
    }
  }

  return { entries, loading, error, cachedAt, refresh, available: sc.available }
}
