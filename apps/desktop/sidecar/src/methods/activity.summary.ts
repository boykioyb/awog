import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadSettings } from '../settings/store.js'
import { loadCredentials } from '../credentials/store.js'
import { cost, getEffectivePricing, parsePricingOverrides } from '../pricing/catalog.js'
import { loadRemotePricingMap } from '../pricing/remote.js'
import { parseBucketKey, rangeToWindow, rollupRange } from '../usage/rollup.js'
import type { UsageBucket } from '../usage/rollup.js'
import type {
  ActivityByAccount,
  ActivityByDay,
  ActivityByModel,
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

  return {
    range: params.range,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    totals,
    byModel,
    byAccount: [...byAccountMap.values()],
    byDay,
    missingPrices: [...missingPrices],
  }
})
