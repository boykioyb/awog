# 0057 — Hard budget guard cho Session (cost / tool-call / wallclock cap)

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-27
- **Người quyết định:** developer (sidecar + UI) + tech-lead

## Bối cảnh

Security rule của AWOG liệt kê invariant **"Loop gọi model → cháy tiền: Budget per
task: max tokens / calls / wallclock"** (`.claude/rules/security.md`). Trước đây
Sessions track `usage` token + (sau ADR 0054) quy ra cost USD, nhưng **không có
ngưỡng chặn** — một turn lặp tool vô hạn hoặc một session dài có thể đốt tiền không
kiểm soát. Soft budget (cảnh báo) đã thêm ở pha trước nhưng chỉ hiển thị, không chặn.

Ràng buộc:

- Local-first, không database. Budget là metadata session (round-trip qua `sessions.upsert`).
- Cost spent phải tính **sidecar-side** từ turn đã persist — KHÔNG tin giá trị client
  gửi lên (một guard bảo mật không được dựa vào số liệu client có thể sai/cũ).
- Không trùng lặp bảng giá: cost dùng `pricing/catalog.ts` (nguồn giá duy nhất, ADR 0054).
- Không được throw ra khỏi `beforeToolCall` (đã là contract — lỗi ⇒ fail-safe block).

## Quyết định

Ba cap, chặn ở 2 tầng:

1. **`hardLimitUsd` — pre-turn refusal** (tại `sessions.send-message.ts`): đầu turn,
   tính cumulative cost = Σ `message.usage.costUsd` của các turn agent đã persist
   (folded từ JSONL). Nếu `cumulative >= hardLimitUsd` → **return sớm trước khi gọi
   model**, không persist gì (turn không có side effect), trả `stopReason:
   'budget-exceeded'` + `errorMessage`. Limit lấy từ params (ý định cấu hình của user);
   cost tính sidecar-side (không tin client).

2. **`maxToolCalls` / `maxWallclockMs` — per-turn cap** (tại runtime `beforeToolCall`):
   helper `withTurnBudget()` (`runtime/permission.ts`) bọc `makeBeforeToolCall`, đếm
   số tool call + đo wallclock từ lúc turn bắt đầu; vượt → `{ block: true, reason }`.
   Backstop chống runaway-loop, độc lập với permission mode. No-op khi không set cap.

UI: field nhập 4 ngưỡng ở `SessionConfigPopover` (Soft $, Hard $, Max tool calls, Max
phút). Khi `budget-exceeded`, store render error block (raise cap ở config → gửi lại);
turn bị từ chối KHÔNG merge usage (tránh xoá snapshot context-window), KHÔNG drain queue,
KHÔNG auto-title (vì auto-title là một model call sẽ lách cap).

## Hệ quả

- **Tích cực:** đóng invariant "budget per task"; chống cháy tiền do loop/lỗi; cost
  vẫn 1 nguồn giá (DRY); guard không tin client.
- **Đánh đổi:** `hardLimitUsd` chính xác tới mức bảng giá `pricing/catalog.ts` cập nhật
  (model không có giá → cost 0 → không chặn). `maxToolCalls` đếm MỌI tool call (kể cả
  read) — là backstop thô, không phải kiểm soát mịn. Turn bị từ chối hiện chưa persist
  user message (semantics "không có gì xảy ra"); reload sẽ mất message lạc quan đó.
- **Tham chiếu:** soft budget + cost display ([docs/features/session-cost-budget.md](../features/session-cost-budget.md)),
  pricing ([ADR 0054](0054-activity-usage-cost-rollup.md)).
