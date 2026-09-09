// Bảng giá "hiệu lực" (catalog mặc định + tầng remote + override của người dùng),
// nạp MỘT LẦN cho cả tiến trình.
//
// Tách ra khỏi tasks/budget.ts vì nay có hai người dùng chung một tri thức: hàng
// rào ngân sách của task, và cổng trần-tiền giữa lượt của runtime Pi (nơi phải quy
// usage đo được ra USD ngay trong lúc lượt đang chạy, tức là không được await).
// Guard không cần độ tươi tuyệt đối — đổi giá thì restart sidecar.

import { cost, getEffectivePricing, parsePricingOverrides } from './catalog.js'
import type { UsageBuckets } from './catalog.js'
import { loadRemotePricingMap } from './remote.js'
import { loadSettings } from '../settings/store.js'
import { log } from '../util/logger.js'

export interface PricingTables {
  overrides: ReturnType<typeof parsePricingOverrides>
  remote: Awaited<ReturnType<typeof loadRemotePricingMap>>
}

let once: Promise<PricingTables> | null = null

export function loadPricingTables(): Promise<PricingTables> {
  if (!once) {
    once = (async () => {
      try {
        const settings = await loadSettings()
        return { overrides: parsePricingOverrides(settings), remote: await loadRemotePricingMap() }
      } catch (err) {
        log.warn('pricing: load failed — falling back to the default catalog', {
          err: err instanceof Error ? err.message : String(err),
        })
        return { overrides: {}, remote: {} }
      }
    })()
  }
  return once
}

// USD cho một cụm token của một model. Model không có trong bảng giá ⇒ 0: không
// biết giá thì không được đoán, và các chiều đo khác (tool call, wallclock) là lưới
// an toàn cho trường hợp đó.
export function costUsd(tables: PricingTables, model: string, tokens: UsageBuckets): number {
  const price = getEffectivePricing(model, tables.overrides, tables.remote)
  return price ? cost(tokens, price) : 0
}
