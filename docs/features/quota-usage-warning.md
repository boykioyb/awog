# Feature: Quota Usage Warning

**Trạng thái:** In Review
**Owner:** Developer

## Overview

Cảnh báo **chủ động (proactive)** khi mức dùng gói (plan usage) của tài khoản subscription — Anthropic (claude.ai) hoặc OpenAI Codex — chạm ngưỡng do người dùng cấu hình (mặc định **80%**). Khi vượt ngưỡng, AWOG hiển thị **banner trong app** + **native notification**, và tùy chọn **dừng toàn bộ session đang chạy** (kill-switch, opt-in).

Khác với [Connection Quota Handling](connection-quota-handling.md) — vốn xử lý *reactive* lỗi 429/quota của provider giữa lúc chạy workflow task (pause → cập nhật key → resume). Feature này theo dõi *trước*, dựa trên `account.usage` (rate-limit utilization), không chờ tới lúc bị provider từ chối.

## User Stories

- *Là người dùng gói Claude/Codex*, tôi muốn được báo trước khi sắp cạn quota để chủ động giãn việc, tránh bị chặn đột ngột giữa turn.
- *Là người dùng*, tôi muốn tự đặt ngưỡng cảnh báo (vd 80%) thay vì một con số cố định.
- *Là người dùng cẩn trọng chi phí*, tôi muốn AWOG **tự dừng mọi session** khi quota chạm ngưỡng, như một van an toàn.
- *Là người dùng*, tôi muốn AWOG **chặn tạo session mới** khi đang quá ngưỡng, để không lỡ tay mở thêm việc.
- *Là người dùng*, tôi muốn tắt hẳn cảnh báo này nếu thấy phiền.

## Cấu hình (Settings → Workspace)

| Thiết lập | Key | Mặc định | Ghi chú |
|---|---|---|---|
| Bật cảnh báo quota | `quotaWarning.enabled` | `true` | Tắt → không poll, không banner, không notify. |
| Ngưỡng cảnh báo (%) | `quotaWarning.threshold` | `80` | Clamp `[50, 99]`. |
| Dừng mọi session khi chạm ngưỡng | `quotaWarning.abortSessionsOnThreshold` | `false` | **Destructive, opt-in.** Hủy mọi lượt session đang chạy khi util ≥ ngưỡng. |
| Chặn session mới khi chạm ngưỡng | `quotaWarning.blockNewSessionsOnThreshold` | `false` | **Opt-in.** `createSession` trả `null` khi util ≥ ngưỡng (pre-flight gate). |

Persist qua `useQuotaWarningSettings` (localStorage `awog.quota-warning.v1`, mirror `useGitSettings`/`useComposerSettings`). Client-only — không đẩy sidecar.

## Functional Behavior

### Watcher (`stores/quota.ts`)

App-lifetime singleton, `subscribe()` gọi từ [app.vue](../../apps/desktop/ui/app.vue):

- **Poll:** initial 20s → mỗi 5 phút (sidecar cache `account.usage` 60s) + khi window `focus` (debounce 60s).
- Mỗi lần `check()`:
  1. Đọc `quotaWarning` (re-read mỗi poll → bật/tắt có hiệu lực ở poll kế tiếp).
  2. Tìm provider có **active account `authMode === 'oauth'`** (anthropic / openai). Provider khác không có usage surface → bỏ qua.
  3. Gọi `account.usage` (best-effort, `force:false`); gom entry có `round(utilization*100) >= threshold` thành `alerts` (worst-first).
  4. **Rising-edge dedupe** (`acted` set theo `provider:rateLimitType`): chỉ notify lần đầu vượt; key tụt dưới ngưỡng → quên đi để lần sau vượt lại báo tiếp.
  5. Nếu `abortSessionsOnThreshold` → gọi `sessions.cancelAllRunning()` (kill-switch liên tục khi còn trên ngưỡng).
  6. Notify khi có breach mới **hoặc** vừa abort được session (respect `settings.notificationsEnabled`; tag `awog-quota` de-dupe; native notify tự ẩn khi window đang focus).

### Banner (`components/QuotaBanner.vue`)

Mount trong [layouts/default.vue](../../apps/desktop/ui/layouts/default.vue) (sau `UpdateBanner`). Mirror style `UpdateBanner`:

- Hiện worst alert: `Plan quota at {pct}% · {label}` (+ `resets in {time}` nếu có `resetsAt`); nếu vừa abort → `Stopped {n} running session(s) — plan quota at {pct}%.`
- Màu: amber (warning band) / đỏ (`utilization ≥ 1`, đã chạm trần).
- Action: **Settings** (mở Settings modal tại section Workspace) · **Dismiss** (ẩn tới breach mới).

### Abort all sessions

`sessions.cancelAllRunning()` lặp `activeMessageBySession` → `cancelMessage(id)` cho từng session, trả về số turn đã nhắm. Tái dùng đường `sessions.cancel` sẵn có (session-scoped, không leak credential).

### Pre-flight gate (chặn session mới)

`quota` store expose `overThreshold` (= `alerts.length > 0`, theo poll gần nhất — synchronous) và `blockNewSessions` (= `enabled && blockNewSessionsOnThreshold && overThreshold`). `sessions.createSession` đọc `blockNewSessions`; nếu chặn → gọi `quota.notifyBlockedNewSession()` (un-dismiss banner + native notify `onlyWhenHidden:false` + background re-check) rồi **trả `null`**. Mọi call site (`pages/sessions`, `pages/projects`) đã handle `null`: bỏ qua navigate/select, giữ nguyên màn hình. Gate dựa trên state của watcher (≤ poll interval cũ) nên best-effort; `notifyBlockedNewSession` kick một `check()` nền để lần thử kế chính xác hơn.

## Acceptance Criteria

- **AC1** — Tài khoản OAuth, usage vượt ngưỡng → banner hiện + (nếu bật notifications & window ẩn) native notification.
- **AC2** — Đổi ngưỡng trong Settings → có hiệu lực ở poll kế tiếp (≤ 5 phút hoặc khi focus).
- **AC3** — Tắt `enabled` → banner biến mất, ngừng poll/notify.
- **AC4** — Bật `abortSessionsOnThreshold`, có session đang chạy, vượt ngưỡng → mọi turn đang chạy bị hủy, banner báo số session đã dừng.
- **AC5** — Bật `blockNewSessionsOnThreshold`, đang quá ngưỡng → click "New session" (mọi entry: dialog, group "+", project menu, projects page) không tạo session; banner hiện lại + native notification giải thích. Tắt setting hoặc quota hồi phục → tạo session bình thường.
- **AC6** — Tài khoản API-key / provider không có usage surface → không bao giờ báo/chặn (không false-positive).
- **AC7** — Quota tụt dưới ngưỡng rồi vượt lại → báo lại (không bị kẹt do đã báo lần trước).
- **AC8** — Không có account / sidecar offline → no-op, không crash, không chặn.

## Invariant & Security

- Không log/leak token: chỉ đọc `utilization` + `resetsAt` từ `account.usage` (đã sanitize ở sidecar).
- Abort đi qua `sessions.cancel` (session-scoped) — không đụng credential.
- Poll best-effort: fetch lỗi không phá vòng lặp, không hiện lỗi đỏ.

## Non-goals (V2)

- Chặn *gửi message* trong session đã tồn tại khi quá ngưỡng (hiện chỉ chặn *tạo* session mới + abort turn đang chạy).
- Ngưỡng riêng cho warn vs abort vs block (hiện dùng chung một ngưỡng).
- Cảnh báo theo **context window** của session (đã có color-code thụ động trong `SessionContextStatus.vue`, không bắn notification).
- Cấu hình per-provider / per-rate-limit-type.
