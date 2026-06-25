import { register } from '../transport/rpc.js'
import { loadSettings } from '../settings/store.js'
import { parsePricingOverrides } from '../pricing/catalog.js'
import { refreshRemotePricing } from '../pricing/remote.js'
import { buildEffectiveModels } from './activity.pricing.js'
import type { ActivityPricingFetch } from '../types/shared.js'

// activity.pricing.fetch (no params) — cập nhật tầng "remote" của pricing từ
// nguồn JSON curated (LiteLLM, URL hardcode L3 trong pricing/remote.ts), persist
// xuống ~/.awog/usage/pricing-remote.json, rồi trả effective catalog SAU merge
// (default ⊕ remote ⊕ override) — giống activity.pricing, mỗi model có `source`.
//   updated = số model AWOG match được từ nguồn remote.
register('activity.pricing.fetch', async (): Promise<ActivityPricingFetch> => {
  // Fetch + map + persist tầng remote (ssrf-guarded, capped). Throw nếu lỗi
  // mạng/parse → caller (UI) hiển thị lỗi; default vẫn còn nguyên trên đĩa.
  const remoteFile = await refreshRemotePricing()

  const settings = await loadSettings()
  const overrides = parsePricingOverrides(settings)
  const models = buildEffectiveModels(overrides, remoteFile.prices)

  return {
    fetchedAt: remoteFile.fetchedAt,
    source: remoteFile.source,
    updated: Object.keys(remoteFile.prices).length,
    models,
  }
})
