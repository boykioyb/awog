// Chọn model cho subagent NGAY TẠI lời gọi `Task` (ADR 0083 §a).
//
// Vì sao có: nhánh Claude SDK cho model chỉ định `model: "opus" | "sonnet" |
// "haiku" | "fable"` trong `AgentInput`; nhánh Pi trước đây chỉ lấy model từ
// frontmatter AGENT.md, nên "giao việc rà soát rẻ tiền cho một model rẻ tiền"
// là bất khả thi trừ khi người dùng sửa file agent.
//
// Ràng buộc quan trọng: KHÔNG để prompt chọn model tự do. Tham số chỉ nhận đúng
// một TIER trong danh sách đóng dưới đây, và mỗi tier phải resolve thành một
// model id mà TÀI KHOẢN đang dùng thực sự chạy được:
//   • Anthropic built-in ⇒ đi qua `MODEL_ALIASES` + `isAnthropicModel` của
//     providers/anthropic/models-map.ts (nguồn sự thật sẵn có, không tự chép lại).
//   • Custom endpoint / provider khác ⇒ chỉ nhận khi CHÍNH account liệt kê một
//     model id chứa tên tier (`account.models`, do người dùng khai). Ngoài ra
//     giữ nguyên model thừa kế của turn cha và nói thẳng cho model biết —
//     không im lặng đổi model, cũng không bịa một id để provider trả 400.

import { isAnthropicModel, normalizeModelId } from '../../providers/anthropic/models-map.js'
import type { AccountRecord, SessionSettings } from '../../types/shared.js'

export const SUBAGENT_MODEL_TIERS = ['opus', 'sonnet', 'haiku', 'fable', 'inherit'] as const

export type SubagentModelTier = (typeof SUBAGENT_MODEL_TIERS)[number]

// Danh sách tier in vào description của tool — một nguồn duy nhất, không chép tay.
export const SUBAGENT_MODEL_TIERS_TEXT = SUBAGENT_MODEL_TIERS.join(' | ')

export function isSubagentModelTier(value: string): value is SubagentModelTier {
  return (SUBAGENT_MODEL_TIERS as readonly string[]).includes(value)
}

export interface TierResolution {
  modelId: string
  // Có mặt khi KHÔNG honour được tier: câu giải thích ngắn (tiếng Anh — nó đi
  // vào tool result cho model đọc, không phải cho UI).
  note?: string
}

// Model id Anthropic cho một tier, hoặc undefined khi catalog không biết nó.
// `fable` không nằm trong MODEL_ALIASES (alias đó phục vụ frontmatter AGENT.md
// kiểu Claude Code) nên map thẳng; các tier còn lại đi qua alias chung.
function anthropicIdForTier(tier: Exclude<SubagentModelTier, 'inherit'>): string | undefined {
  const candidate = tier === 'fable' ? 'claude-fable-5' : normalizeModelId(tier)
  return isAnthropicModel(candidate) ? candidate : undefined
}

// Model id do account tự khai (custom endpoint) khớp tier. So khớp theo token
// tên tier trong id — `gpt-5.5-haiku-ish` không tồn tại, nhưng `qwen3-haiku`,
// `claude-opus-5` thì có; đây là cách duy nhất biết một endpoint lạ có tier nào.
function accountIdForTier(models: string[] | undefined, tier: string): string | undefined {
  return models?.find((id) => id.toLowerCase().includes(tier))
}

// Resolve tier → model id cụ thể cho subagent.
//
// `inheritedModelId` = model subagent sẽ chạy khi không có tier (AGENT.md hoặc
// model của turn cha). Hàm thuần: không chạm credential, không I/O.
export function resolveSubagentModel(
  tier: SubagentModelTier,
  inheritedModelId: string,
  provider: SessionSettings['provider'],
  account: Pick<AccountRecord, 'baseURL' | 'models'>,
): TierResolution {
  if (tier === 'inherit') return { modelId: inheritedModelId }

  // Account tự khai model (custom endpoint) được ưu tiên: với endpoint lạ,
  // catalog Anthropic không nói lên điều gì.
  const declared = accountIdForTier(account.models, tier)
  if (declared) return { modelId: declared }

  // Endpoint tuỳ biến mà không khai model nào khớp ⇒ không có cách nào biết id
  // hợp lệ. Giữ model thừa kế.
  if (account.baseURL) {
    return {
      modelId: inheritedModelId,
      note: `Model tier "${tier}" is not available on this custom endpoint account — the subagent ran on "${inheritedModelId}" instead.`,
    }
  }

  if (provider === 'anthropic') {
    const id = anthropicIdForTier(tier)
    if (id) return { modelId: id }
  }

  return {
    modelId: inheritedModelId,
    note: `Model tier "${tier}" is not available for provider "${provider}" on this account — the subagent ran on "${inheritedModelId}" instead.`,
  }
}
