import { register } from '../transport/rpc.js'
import { loadSettings } from '../settings/store.js'
import {
  defaultModelKeys,
  getCatalogEntry,
  getEffectivePricing,
  parsePricingOverrides,
} from '../pricing/catalog.js'
import { loadRemotePricing } from '../pricing/remote.js'
import type { ActivityPricing, ModelPrice, ProviderName } from '../types/shared.js'

// Display label cho provider (mirror PROVIDER_LABEL của UI). byModel/byAccount
// dùng cùng quy ước, nên pricing cũng trả label cho nhất quán.
const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider
}

// Build effective catalog (default ⊕ remote ⊕ override) → rows ModelPrice sắp
// xếp ổn định. Dùng chung bởi activity.pricing (GET) và activity.pricing.fetch
// để hai method trả cùng shape `models`. Phải gọi loadSettings + loadRemotePricing
// trước rồi truyền vào (tránh đọc lại đĩa hai lần trong fetch).
export function buildEffectiveModels(
  overrides: ReturnType<typeof parsePricingOverrides>,
  remote: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>,
): ModelPrice[] {
  // Tập model: default catalog ∪ model có override ∪ model có giá remote.
  const modelIds = new Set<string>([
    ...defaultModelKeys(),
    ...Object.keys(overrides),
    ...Object.keys(remote),
  ])

  const models: ModelPrice[] = []
  for (const model of modelIds) {
    const price = getEffectivePricing(model, overrides, remote)
    if (!price) continue
    // Provider lấy từ default catalog; model chỉ-có-override/remote (không có
    // default) không biết provider → để trống (UI vẫn hiển thị id + giá).
    const entry = getCatalogEntry(model)
    const provider: ProviderName | undefined = entry?.provider
    models.push({
      model,
      provider: provider ? providerLabel(provider) : '',
      input: price.input,
      output: price.output,
      cacheRead: price.cacheRead,
      cacheWrite: price.cacheWrite,
      isOverride: overrides[model] !== undefined,
      source: price.source,
    })
  }

  // Sắp xếp ổn định: provider rồi model id.
  models.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model))
  return models
}

// activity.pricing — giá hiệu lực USD/1M token cho mọi model có giá
// (default ⊕ remote ⊕ override). Bao cả model chỉ-có-override / chỉ-có-remote.
// isOverride = true nếu user ghi đè model đó; source = tầng cao nhất đóng góp.
// fetchedAt = ISO của lần fetch remote gần nhất (nếu file remote tồn tại).
register('activity.pricing', async (): Promise<ActivityPricing> => {
  const settings = await loadSettings()
  const overrides = parsePricingOverrides(settings)
  const remoteFile = await loadRemotePricing()
  const remote = remoteFile?.prices ?? {}

  const models = buildEffectiveModels(overrides, remote)
  return remoteFile?.fetchedAt ? { models, fetchedAt: remoteFile.fetchedAt } : { models }
})
