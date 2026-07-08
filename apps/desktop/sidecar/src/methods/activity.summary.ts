import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadSettings } from '../settings/store.js'
import { loadCredentials } from '../credentials/store.js'
import { cost, getEffectivePricing, parsePricingOverrides } from '../pricing/catalog.js'
import { loadRemotePricingMap } from '../pricing/remote.js'
import { parseBucketKey, rangeToWindow, rollupRange } from '../usage/rollup.js'
import type { UsageBucket } from '../usage/rollup.js'
import { collectSessionTurnsSince, listSessionSummaries } from '../sessions/store.js'
import type {
  ActivityByAccount,
  ActivityByDay,
  ActivityByModel,
  ActivityBySession,
  ActivitySummary,
  ActivityTotals,
  ProviderName,
} from '../types/shared.js'

const Params = z.object({
  range: z.enum(['1d', '7d', '30d', '90d', 'all']).default('7d'),
  // Lọc theo account (id). Bỏ ⇒ tất cả account.
  accountId: z.string().optional(),
})

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider
}

function totalTokens(b: UsageBucket): number {
  return b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens
}

// Map accountId → { label, provider } từ credentials (KHÔNG đọc secret — chỉ
// id/label/provider). Account đã xoá / không có (vd 'unknown') không có entry →
// caller fallback label = id.
async function buildAccountIndex(): Promise<Map<string, { label: string; provider: ProviderName }>> {
  const index = new Map<string, { label: string; provider: ProviderName }>()
  const creds = await loadCredentials()
  for (const provider of ['anthropic', 'openai', 'google'] as const) {
    for (const acc of creds.providers[provider].accounts) {
      index.set(acc.id, { label: acc.label, provider })
    }
  }
  return index
}

// Per-session mutable accumulator (dominant model tracked via a per-model
// token map, resolved after aggregation).
interface SessionAcc {
  sessionId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  costUsd: number
  turns: number
  lastAt: number
  // model id → tokens (to pick the session's dominant model) + its provider.
  models: Map<string, { tokens: number; provider: string }>
}

// Build the per-session usage breakdown for the window (Sessions only). Reads
// session JSONL tail-first over [fromMs, toMs] — bounded by recent activity, not
// total history (see collectSessionTurnsSince). Cost is applied per turn using
// the turn's own model, so mixed-model sessions (subagents) price correctly.
//
// NOTE: unlike totals/byModel/byDay this does NOT hit the frozen daily rollup
// cache (the rollup drops session id by design), so it re-scans on each call.
// Acceptable for a local-first single-user app; the default range is 7d.
async function buildBySession(
  fromMs: number,
  toMs: number,
  accountIndex: Map<string, { label: string; provider: ProviderName }>,
  filterAccountId: string | undefined,
  overrides: ReturnType<typeof parsePricingOverrides>,
  remote: Awaited<ReturnType<typeof loadRemotePricingMap>>,
): Promise<ActivityBySession[]> {
  const turns = await collectSessionTurnsSince(fromMs, toMs)
  const summaries = await listSessionSummaries()
  const meta = new Map<string, { title: string; projectId?: string }>()
  for (const s of summaries) {
    meta.set(s.id, { title: s.title, ...(s.projectId ? { projectId: s.projectId } : {}) })
  }

  const bySessionMap = new Map<string, SessionAcc>()
  for (const t of turns) {
    // Same account guardrails as the rollup path: drop orphan-account turns and
    // apply the account filter so numbers stay consistent across the page.
    if (!accountIndex.has(t.accountId)) continue
    if (filterAccountId !== undefined && t.accountId !== filterAccountId) continue

    const tokens = t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens
    const price = getEffectivePricing(t.model, overrides, remote)
    const lineCost = price
      ? cost(
          {
            inputTokens: t.inputTokens,
            outputTokens: t.outputTokens,
            cacheReadTokens: t.cacheReadTokens,
            cacheWriteTokens: t.cacheWriteTokens,
          },
          price,
        )
      : 0

    let acc = bySessionMap.get(t.sessionId)
    if (!acc) {
      acc = {
        sessionId: t.sessionId,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        turns: 0,
        lastAt: 0,
        models: new Map(),
      }
      bySessionMap.set(t.sessionId, acc)
    }
    acc.inputTokens += t.inputTokens
    acc.outputTokens += t.outputTokens
    acc.cacheReadTokens += t.cacheReadTokens
    acc.cacheWriteTokens += t.cacheWriteTokens
    acc.totalTokens += tokens
    acc.costUsd += lineCost
    acc.turns += 1
    if (t.at > acc.lastAt) acc.lastAt = t.at
    const m = acc.models.get(t.model)
    if (m) m.tokens += tokens
    else acc.models.set(t.model, { tokens, provider: t.provider })
  }

  const out: ActivityBySession[] = [...bySessionMap.values()].map((acc) => {
    // Dominant model = the one with the most tokens in this session.
    let model = ''
    let provider = ''
    let best = -1
    for (const [id, info] of acc.models) {
      if (info.tokens > best) {
        best = info.tokens
        model = id
        provider = info.provider
      }
    }
    const info = meta.get(acc.sessionId)
    return {
      sessionId: acc.sessionId,
      title: info?.title || acc.sessionId,
      ...(info?.projectId ? { projectId: info.projectId } : {}),
      provider: providerLabel(provider),
      model,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      cacheReadTokens: acc.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens,
      totalTokens: acc.totalTokens,
      costUsd: acc.costUsd,
      turns: acc.turns,
      lastAt: new Date(acc.lastAt).toISOString(),
    }
  })
  // Default order: most tokens first (UI can re-sort).
  out.sort((a, b) => b.totalTokens - a.totalTokens || b.costUsd - a.costUsd)
  return out
}

// activity.summary — gom usage rollup theo range, áp giá hiệu lực → cost, group
// theo model / account / day. Lọc theo accountId nếu có.
register('activity.summary', async (raw): Promise<ActivitySummary> => {
  const params = Params.parse(raw)

  const settings = await loadSettings()
  const overrides = parsePricingOverrides(settings)
  const remote = await loadRemotePricingMap()
  const accountIndex = await buildAccountIndex()

  const { fromMs, toMs } = rangeToWindow(params.range)
  const days = await rollupRange(fromMs, toMs)

  // Accumulators.
  const totals: ActivityTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    turns: 0,
  }
  // model id → aggregate (+ provider id để resolve label sau).
  const byModelMap = new Map<string, ActivityByModel & { providerId: string }>()
  // accountId → aggregate.
  const byAccountMap = new Map<string, ActivityByAccount>()
  const byDay: ActivityByDay[] = []
  const missingPrices = new Set<string>()

  for (const day of days) {
    let dayTokens = 0
    let dayCost = 0
    for (const [key, bucket] of Object.entries(day.buckets)) {
      const { accountId, provider, model } = parseBucketKey(key)
      // Bỏ usage của account mồ côi (đã logout/xoá khỏi credentials): nếu giữ,
      // chúng làm phồng tổng mà không có dòng nhận diện / chọn được trong UI →
      // tổng không khớp bảng BY ACCOUNT. Loại khỏi MỌI số liệu (totals + by* +
      // byDay) để nhất quán.
      if (!accountIndex.has(accountId)) continue
      // Lọc account: bỏ qua bucket không khớp khi filter bật.
      if (params.accountId !== undefined && accountId !== params.accountId) continue

      const tokens = totalTokens(bucket)
      const price = getEffectivePricing(model, overrides, remote)
      // Cost bỏ qua (0) + flag khi model không có giá.
      const lineCost = price
        ? cost(
            {
              inputTokens: bucket.inputTokens,
              outputTokens: bucket.outputTokens,
              cacheReadTokens: bucket.cacheReadTokens,
              cacheWriteTokens: bucket.cacheWriteTokens,
            },
            price,
          )
        : 0
      if (!price && model) missingPrices.add(model)

      // Totals.
      totals.inputTokens += bucket.inputTokens
      totals.outputTokens += bucket.outputTokens
      totals.cacheReadTokens += bucket.cacheReadTokens
      totals.cacheWriteTokens += bucket.cacheWriteTokens
      totals.totalTokens += tokens
      totals.costUsd += lineCost
      totals.turns += bucket.turns

      // by model.
      const existingModel = byModelMap.get(model)
      if (existingModel) {
        existingModel.inputTokens += bucket.inputTokens
        existingModel.outputTokens += bucket.outputTokens
        existingModel.cacheReadTokens += bucket.cacheReadTokens
        existingModel.cacheWriteTokens += bucket.cacheWriteTokens
        existingModel.totalTokens += tokens
        existingModel.costUsd += lineCost
        existingModel.turns += bucket.turns
      } else {
        byModelMap.set(model, {
          model,
          providerId: provider,
          provider: providerLabel(provider),
          inputTokens: bucket.inputTokens,
          outputTokens: bucket.outputTokens,
          cacheReadTokens: bucket.cacheReadTokens,
          cacheWriteTokens: bucket.cacheWriteTokens,
          totalTokens: tokens,
          costUsd: lineCost,
          turns: bucket.turns,
        })
      }

      // by account.
      const resolved = accountIndex.get(accountId)
      const existingAccount = byAccountMap.get(accountId)
      if (existingAccount) {
        existingAccount.totalTokens += tokens
        existingAccount.costUsd += lineCost
        existingAccount.turns += bucket.turns
      } else {
        byAccountMap.set(accountId, {
          accountId,
          label: resolved?.label ?? accountId,
          provider: resolved ? providerLabel(resolved.provider) : providerLabel(provider),
          totalTokens: tokens,
          costUsd: lineCost,
          turns: bucket.turns,
        })
      }

      dayTokens += tokens
      dayCost += lineCost
    }
    byDay.push({ date: day.date, totalTokens: dayTokens, costUsd: dayCost })
  }

  // Strip the internal providerId helper field from byModel before returning.
  const byModel: ActivityByModel[] = [...byModelMap.values()].map((m) => ({
    model: m.model,
    provider: m.provider,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheReadTokens: m.cacheReadTokens,
    cacheWriteTokens: m.cacheWriteTokens,
    totalTokens: m.totalTokens,
    costUsd: m.costUsd,
    turns: m.turns,
  }))

  const bySession = await buildBySession(
    fromMs,
    toMs,
    accountIndex,
    params.accountId,
    overrides,
    remote,
  )

  return {
    range: params.range,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    totals,
    byModel,
    byAccount: [...byAccountMap.values()],
    bySession,
    byDay,
    missingPrices: [...missingPrices],
  }
})
