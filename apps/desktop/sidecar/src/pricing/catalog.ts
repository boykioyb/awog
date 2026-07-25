// Bảng giá per-model (USD / 1M token) cho trang Activity (cost estimate).
//
// Nguồn giá: trang pricing chính thức của từng nhà cung cấp, chốt vào 2026-06.
// Best-effort — KHÔNG phải hoá đơn thật của user (gói subscription, chiết khấu,
// batch, tier dài-ngữ-cảnh đều có thể lệch). User có thể ghi đè từng model qua
// Settings (key `modelPricing`). Mọi entry không chắc giá đều ghi `TODO verify`
// kèm giá ước lượng thay vì để trống (yêu cầu spec).
//
// Bốn bucket khớp với SessionMessage.usage:
//   input       = prompt tokens KHÔNG nằm trong cache
//   output      = completion tokens
//   cacheRead   = prompt tokens phục vụ từ cache (Anthropic prompt-cache read)
//   cacheWrite  = prompt tokens ghi vào cache (cache creation)
//
// Model id ở đây là AWOG model id (mirror utils/models.ts MODELS[].id). Codex
// (ChatGPT subscription) model id được map về model OpenAI tương ứng vì runtime
// báo lại id codex (vd `gpt-5.1-codex`) chứ không phải `gpt-5.1`.

import type { ModelPriceSource, ProviderName } from '../types/shared.js'

// Giá 4 bucket cho một model — đơn vị USD / 1,000,000 token.
export interface ModelPriceRates {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface CatalogEntry extends ModelPriceRates {
  provider: ProviderName
}

// Bảng giá mặc định. Cập nhật khi nhà cung cấp đổi giá. Giữ khoá = AWOG model id.
//
// Anthropic (anthropic.com/pricing, 2026-07):
//   - Fable 5:    $10 input / $50 output ; cacheRead $1.00 ; cacheWrite $12.50
//   - Opus 5:     $5  input / $25 output ; cacheRead $0.50 ; cacheWrite $6.25
//   - Sonnet 5:   $3  input / $15 output ; cacheRead $0.30 ; cacheWrite $3.75  (intro $2/$10 → 2026-08-31)
//   - Haiku 4.5:  $1  input / $5  output ; cacheRead $0.10 ; cacheWrite $1.25
//   - Legacy Opus 4.x: $15/$75 giữ nguyên (best-effort, không sửa trong bản upgrade này)
// OpenAI (openai.com/api/pricing, 2026-06):
//   - GPT-5.1:    $1.25 input / $10 output ; cacheRead $0.125 (no separate write)
//   - GPT-5 mini: $0.25 input / $2  output ; cacheRead $0.025
//   - o3:         $2    input / $8  output ; cacheRead $0.50
//   - GPT-4.1:    $2    input / $8  output ; cacheRead $0.50
// Google (ai.google.dev/pricing, 2026-06):
//   - Gemini 3 Pro:     $2    input / $12 output (≤200k ctx) ; cacheRead $0.20  // TODO verify (preview giá ước lượng theo Gemini 2.5 Pro)
//   - Gemini 2.5 Pro:   $1.25 input / $10 output (≤200k ctx) ; cacheRead $0.125 (no separate write bucket)
//   - Gemini 2.5 Flash: $0.30 input / $2.50 output ; cacheRead $0.075
//   - Gemini 2.0 Flash: $0.10 input / $0.40 output ; cacheRead $0.025
const DEFAULT_CATALOG: Record<string, CatalogEntry> = {
  // ── Anthropic — "5" generation (current) ────────────────────────────────────
  'claude-fable-5': { provider: 'anthropic', input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'claude-opus-5': { provider: 'anthropic', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Biến thể 1M-context map về cùng giá Opus 5 base (chỉ khác beta header).
  'claude-opus-5-1m': {
    provider: 'anthropic',
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 6.25,
  },
  'claude-sonnet-5': { provider: 'anthropic', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },

  // ── Anthropic — legacy (still served) ───────────────────────────────────────
  'claude-opus-4-8': { provider: 'anthropic', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  // Biến thể 1M-context map về cùng giá Opus base (chỉ khác beta header).
  'claude-opus-4-8-1m': {
    provider: 'anthropic',
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  'claude-opus-4-7': { provider: 'anthropic', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4-6': { provider: 'anthropic', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-6': {
    provider: 'anthropic',
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  'claude-haiku-4-5': { provider: 'anthropic', input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },

  // ── OpenAI (pay-as-you-go API key) ──────────────────────────────────────────
  // OpenAI tính prompt-cache read rẻ hơn input nhưng KHÔNG có bucket cache-write
  // riêng (ghi cache miễn phí) → cacheWrite = 0.
  'gpt-5.1': { provider: 'openai', input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5-mini': { provider: 'openai', input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
  o3: { provider: 'openai', input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  'gpt-4.1': { provider: 'openai', input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },

  // ── OpenAI Codex (ChatGPT subscription) ─────────────────────────────────────
  // Runtime báo id codex (`gpt-5.1-codex`, `gpt-5-codex`) khi chạy qua gói
  // ChatGPT. Subscription tính theo quota, KHÔNG theo token → cost USD ở đây chỉ
  // là ước lượng "nếu trả theo API" (lấy bằng giá GPT-5.1). // TODO verify
  'gpt-5.1-codex': { provider: 'openai', input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5-codex': { provider: 'openai', input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },

  // ── Google ──────────────────────────────────────────────────────────────────
  // Gemini không có bucket cache-write riêng (cache implicit) → cacheWrite = 0.
  'gemini-3-pro-preview': {
    provider: 'google',
    input: 2,
    output: 12,
    cacheRead: 0.2,
    cacheWrite: 0,
  },
  'gemini-2.5-pro': { provider: 'google', input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'gemini-2.5-flash': { provider: 'google', input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0 },
  'gemini-2.0-flash': { provider: 'google', input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 },
}

// Giá ghi đè do user cấu hình (Settings key `modelPricing`). Hình dạng linh hoạt;
// chỉ pick 4 trường số hợp lệ, giá trị khác bị bỏ qua (fail-safe, không tin L1).
export type PricingOverrideMap = Record<string, Partial<ModelPriceRates>>

// Đọc map override từ settings blob (đã loadSettings). Trả về map đã làm sạch:
// chỉ giữ model id là string + bucket là số hữu hạn không âm.
export function parsePricingOverrides(settings: Record<string, unknown>): PricingOverrideMap {
  const raw = settings.modelPricing
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: PricingOverrideMap = {}
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!model || typeof value !== 'object' || value === null) continue
    const v = value as Record<string, unknown>
    const rates: Partial<ModelPriceRates> = {}
    for (const bucket of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      const n = v[bucket]
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) rates[bucket] = n
    }
    if (Object.keys(rates).length > 0) out[model] = rates
  }
  return out
}

// Tầng remote (giá lấy từ nguồn curated qua activity.pricing.fetch). Mỗi model
// có đủ 4 bucket USD/1M token. Nằm giữa default và override về độ ưu tiên.
export type RemotePricingMap = Record<string, ModelPriceRates>

// Giá hiệu lực + tầng nào thắng, cho 1 model. Priority: override > remote >
// default (per-bucket: bucket nào ở tầng cao hơn có giá trị thì thắng). source
// là tầng cao nhất có đóng góp bất kỳ bucket nào.
export interface EffectivePricing extends ModelPriceRates {
  source: ModelPriceSource
}

// Giá hiệu lực cho một model = override ⊕ remote ⊕ default (per-bucket). Trả về
// null khi model hoàn toàn không có giá ở mọi tầng → caller flag missingPrices +
// bỏ qua cost. Codex/biến-thể đã có entry riêng trong catalog, nên tra trực tiếp
// theo model id (không cần map alias).
export function getEffectivePricing(
  modelId: string,
  overrides: PricingOverrideMap,
  remote: RemotePricingMap = {},
): EffectivePricing | null {
  const base = DEFAULT_CATALOG[modelId]
  const remoteRates = remote[modelId]
  const override = overrides[modelId]
  if (!base && !remoteRates && !override) return null

  // source = tầng cao nhất có đóng góp. override > remote > default.
  let source: ModelPriceSource = 'default'
  if (remoteRates) source = 'remote'
  if (override) source = 'override'

  const pick = (bucket: keyof ModelPriceRates): number =>
    override?.[bucket] ?? remoteRates?.[bucket] ?? base?.[bucket] ?? 0

  return {
    input: pick('input'),
    output: pick('output'),
    cacheRead: pick('cacheRead'),
    cacheWrite: pick('cacheWrite'),
    source,
  }
}

// Tokens 4-bucket cho 1 lần tính cost.
export interface UsageBuckets {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

// Cost USD = Σ (tokens_bucket / 1e6 × price_bucket). Giá là USD/1M token.
export function cost(tokens: UsageBuckets, price: ModelPriceRates): number {
  return (
    (tokens.inputTokens / 1e6) * price.input +
    (tokens.outputTokens / 1e6) * price.output +
    (tokens.cacheReadTokens / 1e6) * price.cacheRead +
    (tokens.cacheWriteTokens / 1e6) * price.cacheWrite
  )
}

// Toàn bộ key model có giá default — dùng cho activity.pricing (liệt kê giá hiệu
// lực, kèm cả model chỉ-có-override mà không có default).
export function defaultModelKeys(): string[] {
  return Object.keys(DEFAULT_CATALOG)
}

export function getCatalogEntry(modelId: string): CatalogEntry | undefined {
  return DEFAULT_CATALOG[modelId]
}
