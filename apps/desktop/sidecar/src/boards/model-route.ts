// Auto-route model + thinking-level theo TÍNH CHẤT của board item khi dispatch.
//
// "Lead phân việc ⇒ hệ thống tự set model/effort cho agent nhận" — nút "Tối ưu
// model" của editor (WorkspaceBoardAdvConfig) là bản TAY; module này là cùng một
// heuristic nhưng chạy CHỦ ĐỘNG ở sidecar ngay lúc item được đặt vào tay một
// phiên (wakeAssignee của boards.upsert/board-tools) hoặc member được
// materialize (team-members). Cùng một lường chấm ⇒ nút tay và đường auto không
// lệch nhau — GIỮ ĐỒNG BỘ hai bản khi sửa.
//
// Ngữ nghĩa merge: route ĐÈ modelId/level lên override đang có (kể cả custom tay
// của user — dispatch là lúc quyết lại cấu hình theo tính chất việc), nhưng giữ
// nguyên provider/accountId/mode của user vì đó là ràng buộc account, không
// phải "độ mạnh" của model.

import { getModels } from '@earendil-works/pi-ai/compat'
import type { Api, Model } from '@earendil-works/pi-ai'
import { AWOG_EXTRAS, piModels } from '../methods/models.list.js'
import { loadAgent } from '../agents/store.js'
import { setSessionLlmOverride } from '../sessions/store.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import type {
  BoardItem,
  ProviderName,
  SessionAgentRef,
  SessionLlmOverride,
  SessionSummary,
  ThinkingLevel,
} from '../types/shared.js'

// ── Chấm độ phức tạp — mirror của WorkspaceBoardAdvConfig.complexity ──────────
// 0 nhẹ / 1 thường / 2 nặng. Tín hiệu khuôn Jira: story/epic nặng nề, bug nặng
// qua severity, ưu tiên cao đáng model khỏe, brief dài = phạm vi lớn; subtask
// nhẹ hơn một bậc. Kẹp 0..2.
export type RouteTier = 0 | 1 | 2

export function taskComplexity(
  item: Pick<BoardItem, 'type' | 'priority' | 'severity'> & { desc?: string },
): RouteTier {
  let s = 0
  if (item.type === 'epic' || item.type === 'story') s++
  if (item.severity === 'blocker' || item.severity === 'major') s++
  if (item.priority === 'urgent' || item.priority === 'high') s++
  if ((item.desc?.length ?? 0) > 600) s++
  if (item.type === 'subtask') s--
  return s <= 0 ? 0 : s >= 2 ? 2 : 1
}

// Tier của một model id theo heuristic chuỗi — mirror của modelTier() phía UI.
// Biên ký tự bắt buộc để "gemini" không ăn 'mini'.
export function modelTier(id: string): RouteTier {
  const s = id.toLowerCase()
  if (/(^|[^a-z])(haiku|flash|mini|nano|lite)([^a-z]|$)/.test(s)) return 0
  if (/opus|ultra|-pro|o3|o4(?!-mini)|codex-max/.test(s)) return 2
  return 1
}

// Effort theo tier — mirror của EFFORT_OF_TIER phía UI.
const EFFORT_OF_TIER: readonly ThinkingLevel[] = ['low', 'medium', 'high']

// ── Catalog + giá thật ────────────────────────────────────────────────────────
// Catalog đầy đủ của provider: pi (kèm Model.cost thật — ưu tiên xếp theo giá
// thay vì chỉ theo tên) ∪ AWOG_EXTRAS (id mới hơn pi pin, chưa có giá → xếp sau
// các model có giá trong cùng tier). Cache per-provider: catalog tĩnh trong
// tiến trình, dispatch lặp lại không nên đọc lại getModels mỗi lần.
interface CatalogEntry {
  id: string
  tier: RouteTier
  // input + output $/MTok của pi; vắng (extras) = chưa định giá được → đứng cuối
  // tier của mình, chỉ thắng khi không còn lựa chọn có giá.
  cost?: number
}

const catalogCache = new Map<ProviderName, CatalogEntry[]>()

function catalog(provider: ProviderName): CatalogEntry[] {
  const hit = catalogCache.get(provider)
  if (hit) return hit
  const byId = new Map<string, CatalogEntry>()
  try {
    for (const m of getModels(provider) as readonly Model<Api>[]) {
      byId.set(m.id, {
        id: m.id,
        tier: modelTier(m.id),
        ...(m.cost ? { cost: m.cost.input + m.cost.output } : {}),
      })
    }
  } catch {
    /* getModels ném ⇒ chỉ còn extras/piModels fallback */
  }
  // Extras dùng piModels() metadata-free path làm tập hợp id (AWOG_EXTRAS ghi
  // tay, piModels có thể trùng — byId dedup tự nhiên).
  for (const e of [...AWOG_EXTRAS[provider], ...piModels(provider)]) {
    if (!byId.has(e.id)) byId.set(e.id, { id: e.id, tier: modelTier(e.id) })
  }
  const list = [...byId.values()]
  catalogCache.set(provider, list)
  return list
}

// "Rẻ nhất mà đủ": model có tier THẤP NHẤT ≥ target, trong tier ấy thì theo giá
// thật tăng dần (model chưa định giá đứng cuối). Hoà giá ⇒ id NGẮN trước: các
// alias canonical (claude-opus-5, o3) thường là flagship mới còn id dài kèm
// ngày/version là bản cũ. Không có model nào đủ tier ⇒ model mạnh nhất sẵn có.
// Catalog rỗng ⇒ undefined — caller giữ nguyên model đang có thay vì bịa id.
export function pickModel(provider: ProviderName, target: RouteTier): string | undefined {
  const all = catalog(provider)
  if (!all.length) return undefined
  const rank = (a: CatalogEntry, b: CatalogEntry) =>
    a.tier - b.tier ||
    (a.cost ?? Number.MAX_VALUE) - (b.cost ?? Number.MAX_VALUE) ||
    a.id.length - b.id.length ||
    b.id.localeCompare(a.id)
  const fit = all.filter((m) => m.tier >= target).sort(rank)
  // Fallback: mạnh nhất sẵn có = tier cao nhất, trong đó vẫn ưu rẻ/ngắn.
  const strongest = [...all].sort((a, b) => b.tier - a.tier || rank(a, b))[0]
  return (fit[0] ?? strongest)?.id
}

// Route cho MỘT item trên MỘT provider hiệu dụng. `lead` = phiên điều phối:
// không bao giờ xuống dưới tầm giữa — orchestrator rẻ là orchestrator đần
// (đọc diff, chia việc, review đều cần suy luận).
export function routeForItem(
  item: Parameters<typeof taskComplexity>[0],
  provider: ProviderName,
  opts?: { lead?: boolean },
): { modelId?: string; level: ThinkingLevel } {
  const base = taskComplexity(item)
  const target = (opts?.lead ? Math.max(1, base) : base) as RouteTier
  const out: { modelId?: string; level: ThinkingLevel } = {
    level: EFFORT_OF_TIER[target] ?? 'medium',
  }
  const pick = pickModel(provider, target)
  if (pick) out.modelId = pick
  return out
}

// Merge route vào override đang có: modelId/level bị đè theo route, còn lại
// (provider/accountId/mode — ràng buộc account của user) giữ nguyên.
export function applyRoute(
  base: SessionLlmOverride | undefined,
  route: { modelId?: string; level?: ThinkingLevel },
): SessionLlmOverride {
  const out: SessionLlmOverride = { ...(base ?? {}) }
  if (route.modelId) out.modelId = route.modelId
  if (route.level) out.level = route.level
  return out
}

// ── Provider hiệu dụng để route ───────────────────────────────────────────────
// Model phải thuộc đúng nhà mà lượt sẽ chạy, nếu không llmOverride.modelId trỏ
// sang catalog khác provider → runtime resolve không ra → fallback khó đoán.
// Thứ tự khớp đúng thứ tự overlay ở send-message: llmOverride.provider (mới
// nhất, thắng pin agent) → pin provider của agent bind → settings phiên.
async function agentProviderPin(ref: SessionAgentRef | undefined): Promise<ProviderName | undefined> {
  if (!ref?.id) return undefined
  try {
    const a = ref.source
      ? await loadAgent(ref.id, ref.source, ref.projectId)
      : (await loadAgent(ref.id, 'global')) ??
        (ref.projectId ? await loadAgent(ref.id, 'project', ref.projectId) : null)
    return a?.provider ?? undefined
  } catch (err) {
    log.warn('model-route: agent provider lookup failed', {
      agentId: ref.id,
      err: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

export async function effectiveProvider(input: {
  override?: SessionLlmOverride | undefined
  agent?: SessionAgentRef | undefined
  fallback: ProviderName | undefined
}): Promise<ProviderName | undefined> {
  return (
    input.override?.provider ?? (await agentProviderPin(input.agent)) ?? input.fallback
  )
}

// ── Điểm tụ chung của dispatch → phiên SỐNG ──────────────────────────────────
// Route một phiên đang sống theo tính chất item vừa được giao: ghi llmOverride
// đã merge (modelId/level của route thắng; provider/accountId/mode của user
// giữ) + broadcast `session.llm-override` để mọi cửa sổ/popout hội tụ. Bỏ qua
// ghi khi kết quả y hệt override đang có — hai đường dispatch (materialize →
// upsert → wake) có thể đi qua nhau trên cùng một item. KHÔNG ném: caller bọc
// trong wake của nó, route tắc không được làm hỏng việc giao đã ghi.
export async function routeSessionForItem(
  assignee: Pick<SessionSummary, 'id' | 'llmOverride' | 'agent' | 'settings'>,
  item: Parameters<typeof taskComplexity>[0],
  opts?: { lead?: boolean },
): Promise<void> {
  const provider = await effectiveProvider({
    override: assignee.llmOverride,
    agent: assignee.agent,
    fallback: assignee.settings.provider,
  })
  if (!provider) return
  const override = applyRoute(
    assignee.llmOverride,
    routeForItem(item, provider, opts),
  )
  const cur = assignee.llmOverride ?? {}
  if (
    cur.modelId === override.modelId &&
    cur.level === override.level &&
    cur.provider === override.provider &&
    cur.accountId === override.accountId &&
    cur.mode === override.mode
  ) {
    return
  }
  if (await setSessionLlmOverride(assignee.id, override)) {
    emit('session.llm-override', { sessionId: assignee.id, llmOverride: override })
  }
}
