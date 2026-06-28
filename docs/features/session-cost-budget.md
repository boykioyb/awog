# Feature — Cost & Budget guard cho session

## Mục tiêu

Quy `usage` token (đã track) ra **chi phí USD** và đặt **ngưỡng ngân sách** mỗi session:

- **Soft** (`limitUsd`) — chỉ cảnh báo, không chặn. (Pha 1)
- **Hard** (`hardLimitUsd` / `maxToolCalls` / `maxWallclockMs`) — chặn ở sidecar, đóng security
  invariant "budget per task". (Pha 3 — xem cuối)

## Cost (single source of truth ở sidecar)

`pricing/catalog.ts` là nguồn giá duy nhất. `methods/sessions.send-message.ts`:

- `computeTurnCostUsd(modelUsed, usage)` = `getEffectivePricing(modelId, {})` ⊕ `cost(buckets, price)`.
  Trả `undefined` khi model không có giá → UI hiện "n/a" thay vì $0 sai.
- Gắn `costUsd` vào `message.usage` (persist) **và** trả `usage.cost_usd` trong RPC result.

UI store `mergeUsage`: cost là **cumulative** (cộng dồn mỗi turn) — khác token (snapshot context-window
mỗi turn). `usage.cost = (prev.cost ?? 0) + (turn.cost_usd ?? 0)`.

## Mô hình dữ liệu

- `SessionUsage.cost?: number` (cumulative USD).
- `Session.budget?: { limitUsd?; hardLimitUsd?; maxToolCalls?; maxWallclockMs? }`.
  Round-trip qua `sessions.upsert` (metadata).

## UI (Pha 1)

- **Composer**: chip readonly `cost / limit` (tabular-nums), đổi màu danger khi vượt soft; banner
  cảnh báo trên toolbar khi vượt (`sessions.budget.warnBanner`). KHÔNG chặn.
- **SessionDetail** usage popover: dòng "Cost: $x.xx".
- **SessionConfigPopover** (tab General): ô nhập Soft cap + Hard cap (USD), commit on blur; hiện "Spent".
- Helper chung: `composables/useSessionCost.ts` (`fmtUsd`, `costOf`, `overSoft`, `hasBudgetInfo`).
- Store: `setBudget(id, patch)` (merge, strip rỗng).

## File chạm (Pha 1)

- Sidecar: `pricing/catalog.ts` (reuse), `methods/sessions.send-message.ts` (compute + return),
  `types/shared.ts` (`message.usage.costUsd`, `SessionBudget`).
- UI: `composables/useSessionsData.ts` (`SessionUsage.cost`, `SessionBudget`),
  `composables/useSessionCost.ts`, `stores/sessions.ts` (`mergeUsage`, `setBudget`),
  `components/session/SessionComposer.vue`, `SessionConfigPopover.vue`, `SessionDetail.vue`.
- i18n: `sessions.budget.*`, `sessions.detail.cat.cost`.

## Pha 3 — Hard budget guard (đã làm — [ADR 0057](../decisions/0057-session-budget-guard.md))

- **Pre-turn** (`sessions.send-message.ts`): đầu turn tính cumulative cost = Σ
  `message.usage.costUsd` của turn agent đã persist (folded JSONL); nếu `>= hardLimitUsd`
  → return sớm **trước khi gọi model**, không side effect, trả `stopReason:
  'budget-exceeded'` + errorMessage. Limit từ params, cost tính sidecar-side (không tin client).
- **Per-turn cap** (`runtime/permission.ts` `withTurnBudget` bọc `makeBeforeToolCall`):
  đếm tool-call + đo wallclock từ đầu turn; vượt `maxToolCalls` / `maxWallclockMs` →
  `{ block: true }`. Forward qua `RunNonStreamArgs.budget` (runner.ts).
- **UI**: 4 field ở ConfigPopover (Soft $, Hard $, Max tool calls, Max phút); store forward
  hard fields qua `hardBudgetOf()`; `budget-exceeded` → error block; turn từ chối KHÔNG
  merge usage / drain queue / auto-title.

## Giới hạn / ghi chú

- Cost phụ thuộc bảng giá `pricing/catalog.ts` cập nhật; model không có giá → "n/a".
- Cost dùng default catalog (không tính override/remote) → là ước lượng nhanh; Activity page vẫn là
  báo cáo cost chính thức (có override + remote pricing).
