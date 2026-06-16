# Plan: Account Quota Usage trên System Tray

> Spec: [tray-account-usage.md](./tray-account-usage.md) (Ready for PM — tất cả OQ đã chốt; OQ-2 hoãn không chặn)
> ADR: [0039 — Tray account-usage channel](../decisions/0039-tray-account-usage-channel.md) (Accepted)
> Brief: [tray-account-usage.brief.md](./tray-account-usage.brief.md)
> Reactive counterpart (đừng trùng): [connection-quota-handling.md](./connection-quota-handling.md)

## Bối cảnh decompose

- **Hạ tầng đã sẵn ~80%.** RPC `account.usage` (Anthropic cache 60s, Codex snapshot, API-key/custom trả rỗng) + `accounts.list` (AccountSafe) + logic màu/countdown/label trong `SessionContextStatus.vue` + pattern renderer-drive/main-reactive của `updater.ts` đều đã chạy. Phần mới gói gọn ở 4 surface: Codex ping (sidecar), composable + fan-out + sanitize (renderer), `tray.ts` (Electron main), 2 IPC channel mới (preload + main).
- **Tất cả 12 AC + 19 TS đã khoá**, mọi OQ kỹ thuật/chính sách đã chốt (xem spec §Open questions). PM **không** đề xuất OQ mới. OQ-2 (icon priority hợp nhất đợt tray) hoãn nhưng có mặc định AC-9 → không chặn.
- **Lint/format/typecheck gate** ([.claude/rules/lint-format.md](../../.claude/rules/lint-format.md)) coi như nằm trong "Definition of Done" mặc định mỗi task code — KHÔNG tách task riêng. Lưu ý `apps/desktop/electron/` + `apps/desktop/sidecar/` có tsconfig riêng (vue-tsc chỉ cho UI; sidecar/electron dùng `tsc`/build script tương ứng).
- **Tách build-then-consume rõ ràng:** IPC channel + composable phải xong trước khi `tray.ts` tiêu thụ payload. Codex ping (sidecar) độc lập, song song được với toàn bộ nhánh renderer/main.
- **Quan sát code nền (ảnh hưởng ước lượng):**
  - `getCodexUsage(accountId)` hiện **không** expose `capturedAt` ra ngoài (chỉ trả `cachedAt`) → staleness-guard cần thêm hàm đọc `capturedAt` (vd `getCodexCapturedAt` / `isCodexUsageStale`) trong [openai/usage.ts](../../apps/desktop/sidecar/src/providers/openai/usage.ts).
  - `completePi` đã có `onResponse: recordCodexUsageFromHeaders` nhưng **chưa** nhận `maxTokens` → ping cần mở rộng `CompleteArgs.maxTokens` (truyền qua `completeSimple`) hoặc tạo helper ping nhỏ tái dùng `completePi`. Fallback bậc thang 1→16→bỏ nằm ở nhánh `account.usage(openai)`.
  - `UsageEntry` đã có `status` (`allowed | allowed_warning | rejected`) do provider helper cấp → renderer KHÔNG tự tính lại status (AC-4); chỉ tính `overallStatus` = xấu nhất các bucket.

## Bảng tổng

| Nhóm | Surface | Số task | Mục tiêu |
|---|---|---|---|
| A — Sidecar | Codex ping path | 2 | staleness-guard + ping `completePi` (TTL 5′, max-token 1→16→bỏ), không pollute transcript |
| B — Renderer | Composable + fan-out + sanitize | 3 | `useAccountUsage()` (trích từ `SessionContextStatus.vue`) + fan-out tuần tự → `TraySetStatePayload` |
| C — IPC/preload | 2 channel mới | 1 | `tray:setState` (invoke) + `tray:requestUsage` (send) |
| D — Electron main | `tray.ts` | 4 | tách `setupTray`, submenu/tooltip/icon-state, notification throttle/dedupe, trigger wiring |
| E — Settings | gate `notificationsEnabled` | 1 | tái dùng flag (verify đã expose qua sidecar) |
| F — Tests/QA/Docs | | 4 | unit (sidecar/sanitize), manual TS pass, infosec, docs |
| **Tổng** | | **15** | |

---

## A — Sidecar (Codex ping path) — song song được với B/C/D

> Độc lập hoàn toàn với nhánh renderer/main. Có thể bắt đầu ngay, không block bởi gì.

- [ ] **T1. Thêm staleness-guard cho Codex snapshot trong `openai/usage.ts`** — S
  - **Mô tả:** Expose khả năng đọc `capturedAt` của snapshot Codex để nhánh `account.usage` biết snapshot null hay cũ > TTL. Thêm hàm thuần (vd `getCodexCapturedAt(accountId): number | null` hoặc `isCodexUsageStale(accountId, ttlMs): boolean`). KHÔNG đổi shape `getCodexUsage`.
  - **File chạm:** [apps/desktop/sidecar/src/providers/openai/usage.ts](../../apps/desktop/sidecar/src/providers/openai/usage.ts)
  - **AC references:** AC-8 (staleness-guard), AC-12 (snapshot mất sau restart → null → ping)
  - **Owner:** developer
  - **Ước lượng:** S
  - **Depends on:** none
  - **Acceptance:** Hàm trả `capturedAt` (ms) khi có snapshot, `null` khi chưa; unit test xác nhận stale khi `now - capturedAt > 300_000` và fresh khi trong TTL. KHÔNG thêm side-effect, KHÔNG log token.

- [ ] **T2. Mở rộng nhánh `provider === 'openai'` của `account.usage`: ping khi stale** — M
  - **Mô tả:** Trong `account.usage` (Codex OAuth, snapshot null hoặc `capturedAt` > TTL 5′): ping 1 `completePi` rẻ với `maxTokens` bậc thang `1 → 16 → bỏ`, prompt `"ping"`, no-tools, no-session, `onResponse = recordCodexUsageFromHeaders` (đã có sẵn trong `completePi`), rồi đọc lại `getCodexUsage`. Ping **mọi** Codex OAuth account stale (OQ-9). Snapshot còn tươi → trả luôn, KHÔNG ping. Ping fail/timeout → trả `{ profile: null, usage: [], cachedAt }` ("không khả dụng"), KHÔNG throw. Cần mở rộng `CompleteArgs` thêm `maxTokens?` (truyền vào `completeSimple`) hoặc helper ping nhỏ.
  - **File chạm:** [apps/desktop/sidecar/src/methods/account.usage.ts](../../apps/desktop/sidecar/src/methods/account.usage.ts), [apps/desktop/sidecar/src/runtime/complete.ts](../../apps/desktop/sidecar/src/runtime/complete.ts) (thêm `maxTokens`)
  - **AC references:** AC-8, AC-10 (API-key vẫn rỗng), AC-12
  - **Owner:** developer
  - **Ước lượng:** M
  - **Depends on:** T1
  - **Acceptance:** Codex account chưa turn nào → ping nạp snapshot → trả usage có %; snapshot tươi (< TTL) → KHÔNG ping (kiểm log); ping fail → unavailable không throw; **KHÔNG** tạo session/JSONL/trace/event UI; token ở nguyên sidecar; min-token 1 bị từ chối → tự thử 16 → vẫn lỗi thì unavailable.
  - **Risk:** Provider từ chối `max_tokens < N` (min-token). Mitigate bằng fallback bậc thang đã chốt; KHÔNG retry tiếp sau 16.

---

## B — Renderer (composable + fan-out + sanitize) — block D

> Phải xong T5 (payload sanitized) trước khi `tray.ts` (D2/D3) tiêu thụ. T3 (trích composable) là refactor thuần, song song với A.

- [ ] **T3. Trích logic usage từ `SessionContextStatus.vue` ra composable `useAccountUsage()`** — M
  - **Mô tả:** Trích `RATE_LIMIT_LABELS`, `utilizationColor`, `formatResetsIn`, `rateLimitLabel`, type `UsageEntry`/`RateLimitType`/`ProfileShape` ra composable dùng chung (Rule of Three: popover + tray). `SessionContextStatus.vue` refactor để consume composable, **không** đổi behavior popover. Composable KHÔNG `import fs`/SDK (đi qua sidecar IPC). Thêm helper `overallStatusOf(buckets)` = xấu nhất (`rejected` > `allowed_warning` > `allowed`).
  - **File chạm:** tạo `apps/desktop/ui/composables/useAccountUsage.ts`; sửa [apps/desktop/ui/components/session/SessionContextStatus.vue](../../apps/desktop/ui/components/session/SessionContextStatus.vue)
  - **AC references:** AC-3 (render %/màu/countdown/label), AC-4 (status), Dependencies §Phần mới
  - **Owner:** developer
  - **Ước lượng:** M
  - **Depends on:** none
  - **Acceptance:** `pnpm typecheck` + `pnpm lint` xanh; popover Session vẫn render % / màu / countdown / refresh y như cũ (regression-free); `overallStatusOf` unit-testable trả đúng worst-case.

- [ ] **T4. Định nghĩa types `TraySetStatePayload` / `TrayAccountUsage` / `TrayUsageBucket`** — S
  - **Mô tả:** Khai type theo spec §Data shape. Đặt nơi cả renderer (build payload) lẫn preload (type bridge) tham chiếu được — đề xuất `apps/desktop/ui/types/index.ts` cho phía renderer; preload có bản mirror cục bộ (như `UpdateEvent` hiện mirror ở [preload.ts](../../apps/desktop/electron/src/preload.ts)). KHÔNG có field token/email/UUID/request-ID/raw body trong type.
  - **File chạm:** [apps/desktop/ui/types/index.ts](../../apps/desktop/ui/types/index.ts)
  - **AC references:** AC-11 (sanitized), spec §Data shape
  - **Owner:** tech-lead
  - **Ước lượng:** S
  - **Depends on:** none
  - **Acceptance:** Type compile sạch; field khớp đúng spec (`accountId`, `provider`, `label`, `plan?`, `available`, `isActive`, `overallStatus`, `buckets[]` + bucket `rateLimitType/utilization/status/resetsAt?`; payload `accounts[] + fetchedAt`). Comment ghi rõ "KHÔNG token/key/email/UUID".
  - **Note:** Owner TL vì đây là hợp đồng kiểm toán invariant #1 (ADR 0039 đóng đinh shape).

- [ ] **T5. `useAccountUsage()`: fan-out tuần tự + sanitize → `TraySetStatePayload`** — M
  - **Mô tả:** Trong composable, thêm action orchestrate: gọi `accounts.list` → lọc account OAuth/subscription → gọi `account.usage` **tuần tự** (concurrency ≤ 1–2, `force=false` để tái dùng cache 60s). Account `authMode !== 'oauth'` (API-key/custom): skip RPC, đánh `available:false`. Lỗi 1 account (429/timeout) → đánh `available:false` + tiếp tục, KHÔNG fail toàn cục. Build `TrayAccountUsage` chỉ với field sanitized (`accountId` local + `label` + `plan` + `provider` + `isActive` + `overallStatus` + `buckets`); **loại** email/token/UUID/raw body. Gọi `window.awog.setTrayState(payload)`.
  - **File chạm:** `apps/desktop/ui/composables/useAccountUsage.ts`; có thể thêm wiring ở [apps/desktop/ui/stores/settings.ts](../../apps/desktop/ui/stores/settings.ts) (đọc activeAccountId/label) hoặc trực tiếp từ `accounts.list`
  - **AC references:** AC-2, AC-5 (fan-out tuần tự tôn trọng cache), AC-10, AC-11 (sanitize)
  - **Owner:** developer
  - **Ước lượng:** M
  - **Depends on:** T3, T4, T6 (cần `setTrayState` bridge tồn tại)
  - **Acceptance:** 3 account (Max OAuth + Codex OAuth + API-key) → payload có đủ 3, API-key `available:false`; gọi tuần tự (không parallel-storm); 1 account 429 → `available:false`, account khác vẫn build; payload KHÔNG chứa email/token/UUID (verify object keys); `overallStatus` đúng worst-case.
  - **Risk:** Fan-out rate-limit nếu vô tình `force=true` hoặc song song → giữ tuần tự + `force=false` nghiêm ngặt.

---

## C — IPC / preload (2 channel mới) — block D + B(T5)

- [ ] **T6. Thêm cặp channel `tray:setState` + `tray:requestUsage` ở preload + main** — S
  - **Mô tả:** Bổ sung `window.awog.setTrayState(payload)` (invoke `tray:setState`, renderer→main) + `window.awog.onTrayRequestUsage(handler)` (lắng `tray:requestUsage`, main→renderer, trả unsubscribe) vào [preload.ts](../../apps/desktop/electron/src/preload.ts) (mirror pattern `onUpdateEvent`). Phía main: `ipcMain.handle('tray:setState', …)` + sender `getWindow()?.webContents.send('tray:requestUsage')` — đặt trong module `tray.ts` (T7). **KHÔNG** đi qua `engine:request`.
  - **File chạm:** [apps/desktop/electron/src/preload.ts](../../apps/desktop/electron/src/preload.ts); handler đăng ký trong `apps/desktop/electron/src/tray.ts` (T7) — có thể tạm stub handler để T6 đứng độc lập
  - **AC references:** AC-11 (channel riêng, không qua engine), ADR 0039 §IPC contract
  - **Owner:** developer
  - **Ước lượng:** S
  - **Depends on:** T4 (type payload)
  - **Acceptance:** `setTrayState` gửi được payload sang main và resolve; `onTrayRequestUsage` nhận signal + unsubscribe sạch; preload compile + sandbox-safe (chỉ qua contextBridge, renderer không chạm `ipcRenderer` trực tiếp — invariant #4).

---

## D — Electron main (`tray.ts`) — block bởi B + C

> Tách `setupTray` khỏi `main.ts` trước (D1), rồi cộng dồn submenu/icon (D2), notification (D3), trigger (D4). D2/D3/D4 cần T5 (payload) + T6 (channel).

- [ ] **T7. Tách `setupTray` từ `main.ts` ra module `tray.ts` (scaffold + state holder)** — S
  - **Mô tả:** Di chuyển `setupTray()` hiện tại sang `apps/desktop/electron/src/tray.ts`, export `setupTray(getWindow)`. Giữ nguyên behavior hiện có (icon + Show/Quit menu + click→focus). Thêm khung state holder cho `latestPayload: TraySetStatePayload | null` + đăng ký handler `tray:setState` (T6) cập nhật state + rebuild menu (D2 sẽ điền nội dung). `main.ts` chỉ còn `import { setupTray } from './tray'`.
  - **File chạm:** tạo `apps/desktop/electron/src/tray.ts`; sửa [apps/desktop/electron/src/main.ts](../../apps/desktop/electron/src/main.ts)
  - **AC references:** Dependencies §Phần mới (module tray), AC-12 (placeholder trước fetch đầu)
  - **Owner:** developer
  - **Ước lượng:** S
  - **Depends on:** T6
  - **Acceptance:** App build + chạy; tray vẫn hiện Show/Quit + click focus như cũ (regression-free); chưa có payload → submenu placeholder "Đang tải usage…" / "Engine chưa sẵn sàng" tùy ngữ cảnh, KHÔNG crash.

- [ ] **T8. Dynamic submenu + tooltip + icon-state từ `tray:setState`** — M
  - **Mô tả:** Trong `tray.ts`, build menu từ `latestPayload` (OQ-4 render): mỗi account 1 dòng menu gốc `"{✓?}{label} · {plan} · 5h {pct}% {⚠|✕} · wk {wkPct}% · reset {countdown}"`; account không khả dụng = `"{label} · usage không khả dụng"` (không %, không sym); submenu con/bucket = `MenuItem enabled:false` (RATE_LIMIT_LABELS + % + countdown) + dòng `"Cập nhật lúc HH:MM"` (từ `fetchedAt`). Tooltip = account active + % cao nhất. Icon-state: overlay nativeImage amber (warning) / đỏ (rejected), priority gộp task-state theo AC-9 (`Failed > Usage Rejected > Waiting Approval > Usage Warning > Running > Idle`). Map `status → symbol` bằng hằng nhỏ ở main (không cần theme). Click account = chỉ focus app (OQ-10, KHÔNG deeplink).
  - **File chạm:** `apps/desktop/electron/src/tray.ts`; có thể cần asset icon overlay (vd `apps/desktop/electron/assets/` hoặc dùng `nativeImage` dựng programmatic) — xem [paths.ts](../../apps/desktop/electron/src/paths.ts) cho `trayIconPath`
  - **AC references:** AC-2, AC-3, AC-4, AC-9, AC-10, AC-12, edge case "reset khi menu mở" (snapshot tĩnh)
  - **Owner:** developer
  - **Ước lượng:** M
  - **Depends on:** T5, T7
  - **Acceptance:** 3 account render đủ; Max 92% → "92%" + ⚠; rejected → ✕ + icon đỏ; API-key → "không khả dụng" không sym; active có ✓; dòng "Cập nhật lúc HH:MM" hiện đúng; click account chỉ focus (không navigate); icon priority đúng AC-9 khi có task Failed + usage rejected → giữ Failed.
  - **Risk:** Per-OS icon overlay (macOS template image cho base + overlay non-template giữ màu; Win/Linux nativeImage thường). Cần test cả 3 nền (đẩy sang QA T13/T14).

- [ ] **T9. Native notification ở main: trigger + throttle/dedupe + gate** — M
  - **Mô tả:** Trong `tray.ts`, sau khi nhận `tray:setState`: với account `overallStatus ∈ {allowed_warning, rejected}` → đánh giá trigger. Bắn `new Notification` của Electron **chỉ khi** window KHÔNG focus (OQ-6) **và** `notificationsEnabled === true` (E/T11). Dedupe theo khóa `{accountId, level}` (`level ∈ {warning, rejected}`); escalation warning→rejected = level mới (bắn lại); clear dedupe khi account xuống < 90%; gộp N ≥ 2 account cùng vượt trong 1 fetch thành 1 notification "N account gần cạn quota" (OQ-5). Body: `"{label} ({plan}) {bucket label}: {pct}%."` — KHÔNG email/token/raw error/request-ID (OQ-7, AC-11). Click notification = chỉ show+focus (OQ-10).
  - **File chạm:** `apps/desktop/electron/src/tray.ts`
  - **AC references:** AC-6, AC-7, AC-11 (notification body sanitized)
  - **Owner:** developer
  - **Ước lượng:** M
  - **Depends on:** T8
  - **Acceptance:** App nền + account 91% → 1 notification "Quota gần cạn"; 100% → "Quota đã cạn"; cùng 91% qua 2 lần fetch → 1 notification (dedupe); 91%→100% → notification mới; reset→leo lại → notification mới; 2 account vượt → 1 notification gộp; window focus → KHÔNG notification (icon+submenu vẫn cập nhật); `notificationsEnabled=false` → KHÔNG notification; body KHÔNG email/token.
  - **Risk:** Trạng thái dedupe + icon state phình `tray.ts` → giữ state cục bộ module gọn, có comment.

- [ ] **T10. Trigger wiring: `tray.on('click')` + window `'focus'` + debounce ≤1 fetch/60s** — S
  - **Mô tả:** Trong `tray.ts`, lắng `tray.on('click')` + `tray.on('right-click')` (best-effort) + `BrowserWindow 'focus'` → debounce tổng ≤ 1 fetch / 60s ở main → gửi `tray:requestUsage` xuống renderer (renderer fan-out + đẩy `tray:setState` về cho lần mở kế tiếp). Native menu tĩnh nên lần mở hiện tại dùng snapshot gần nhất (đã có dòng "Cập nhật lúc HH:MM" ở T8).
  - **File chạm:** `apps/desktop/electron/src/tray.ts`; có thể cần wiring window `focus` listener (window ref qua `getWindow`)
  - **AC references:** AC-1 (cadence chỉ mở-menu + focus, KHÔNG timer nền), edge case "focus liên tục alt-tab" (debounce)
  - **Owner:** developer
  - **Ước lượng:** S
  - **Depends on:** T6, T8
  - **Acceptance:** Mở tray khi focus → 1 `tray:requestUsage`; alt-tab nhiều lần trong 60s → tối đa 1 fetch (debounce); app mất focus 5 phút → KHÔNG fetch nền, KHÔNG timer chạy; macOS/Win/Linux cùng cơ chế.
  - **Risk:** Per-OS — macOS left-click mở menu ngay (state về sau), Win/Linux right-click context menu. Chấp nhận stale ngắn theo Non-goal; verify ở QA.

---

## E — Settings (gate `notificationsEnabled`) — song song được

- [ ] **T11. Verify/expose `notificationsEnabled` cho main đọc khi gate notification** — S
  - **Mô tả:** Notification bắn ở **main** (T9) nhưng flag `notificationsEnabled` sống ở renderer settings store. Cần truyền trạng thái flag xuống main: hoặc đính kèm 1 field `notificationsEnabled` vào `TraySetStatePayload` (renderer là source of truth, main đọc theo từng fetch), hoặc kênh riêng. Quyết định cơ chế (đề xuất: thêm vào payload — đơn giản, đồng bộ theo fetch). Xác nhận flag đã tồn tại trong [settings.ts](../../apps/desktop/ui/stores/settings.ts) (tái dùng, KHÔNG tạo mới — mirror connection-quota-handling AC-10).
  - **File chạm:** [apps/desktop/ui/stores/settings.ts](../../apps/desktop/ui/stores/settings.ts) (verify flag), `apps/desktop/ui/composables/useAccountUsage.ts` (đính flag vào payload), [apps/desktop/ui/types/index.ts](../../apps/desktop/ui/types/index.ts) (nếu thêm field), `apps/desktop/electron/src/tray.ts` (đọc flag)
  - **AC references:** AC-6 (gate notificationsEnabled)
  - **Owner:** developer
  - **Ước lượng:** S
  - **Depends on:** T4, T5
  - **Acceptance:** `notificationsEnabled=false` → main không bắn notification (vẫn cập nhật icon/submenu); flag bật lại → notification hoạt động; KHÔNG tạo flag/setting trùng.
  - **Note:** Nếu chọn đính vào payload thì T4 (types) cần thêm field — cập nhật ngược T4.

---

## F — Tests / QA / Infosec / Docs

- [ ] **T12. Unit test: Codex ping path + sanitize helper** — M
  - **Mô tả:** Test sidecar: (a) staleness-guard (T1) fresh/stale theo TTL; (b) `account.usage(openai)` ping khi stale, KHÔNG ping khi fresh, fail→unavailable không throw, fallback min-token 1→16→bỏ; (c) ping KHÔNG tạo session/JSONL/trace (assert không gọi session store). Test renderer: (d) sanitize `useAccountUsage()` build payload — assert KHÔNG key email/token/UUID/raw body; (e) `overallStatusOf` worst-case; (f) fan-out 1 account lỗi vẫn build account còn lại.
  - **File chạm:** test cạnh [account.usage.ts](../../apps/desktop/sidecar/src/methods/account.usage.ts) + [openai/usage.ts](../../apps/desktop/sidecar/src/providers/openai/usage.ts); test cạnh `useAccountUsage.ts`
  - **AC references:** AC-5, AC-8, AC-10, AC-11; TS-9, TS-10, TS-11, TS-12, TS-18
  - **Owner:** qa-tester
  - **Ước lượng:** M
  - **Depends on:** T2, T5
  - **Acceptance:** Tất cả test xanh; coverage cho fresh/stale/fail ping + sanitize keys + fan-out error isolation.

- [ ] **T13. Infosec audit: `tray:setState` payload + notification body + ping log** — S
  - **Mô tả:** Audit invariant #1/#4: inspect payload `tray:setState` thực tế (runtime) + notification body → KHÔNG access/refresh token, apiKey, request-ID, org/account UUID, **email**. Verify main KHÔNG có lối gọi provider endpoint trực tiếp (chỉ tiêu thụ payload). Đọc log sidecar khi Codex ping → chỉ header NAMES (như `recordCodexUsageFromHeaders` hiện log), KHÔNG token.
  - **File chạm:** review-only (inspect runtime + [tray.ts](../../apps/desktop/electron/src/tray.ts), [account.usage.ts](../../apps/desktop/sidecar/src/methods/account.usage.ts), [openai/usage.ts](../../apps/desktop/sidecar/src/providers/openai/usage.ts), [complete.ts](../../apps/desktop/sidecar/src/runtime/complete.ts))
  - **AC references:** AC-11; TS-14, TS-15
  - **Owner:** infosec (qua agent `infosec` + skill `security-audit`)
  - **Ước lượng:** S
  - **Depends on:** T2, T5, T9
  - **Acceptance:** Audit pass — không field nhạy cảm trong payload/notification/log; main không gọi provider; ghi kết quả vào audit log. HARD BLOCK merge nếu vi phạm.

- [ ] **T14. Manual QA pass: chạy TS-1..TS-19 trên build dev (3 nền nếu khả thi)** — M
  - **Mô tả:** Chạy đủ 19 test scenario của spec trên build dev, ưu tiên macOS + ≥1 nền Win/Linux cho icon overlay + trigger per-OS. Ghi pass/fail vào QA log, mở issue follow-up nếu có bug. Tập trung: cadence (TS-1), all-account (TS-2), render+màu (TS-3/4), notification trigger + im-khi-focus (TS-5/5b), throttle/escalation/reset (TS-6/7), batch (TS-8), Codex ping + staleness (TS-9/10), ping fail (TS-11), icon priority (TS-13), click chỉ focus (TS-16), sidecar down (TS-17), 429 fan-out (TS-18), lifecycle placeholder (TS-19).
  - **File chạm:** QA log (ngoài repo hoặc issue)
  - **AC references:** toàn bộ AC-1..AC-12; TS-1..TS-19
  - **Owner:** qa-tester
  - **Ước lượng:** M
  - **Depends on:** T9, T10, T11, T12
  - **Acceptance:** TS-1..TS-19 chạy đủ, kết quả ghi nhận; bug (nếu có) có issue follow-up.
  - **Risk:** Per-OS trigger + icon overlay là chỗ dễ lệch nhất → cần ≥2 nền.

- [ ] **T15. Cập nhật tài liệu: README ADR index + CLAUDE.md stack + ui/README + design doc map** — S
  - **Mô tả:** README index ADR đã thêm 0039 (verify); CLAUDE.md bảng stack ghi kênh tray account-usage; [apps/desktop/ui/README.md](../../apps/desktop/ui/README.md) note composable `useAccountUsage()` + tray usage; [design/tray-and-notifications.md](../design/tray-and-notifications.md) đánh dấu đề xuất #6 đã triển khai (notification chuyển sang main); spec đổi trạng thái sang Done.
  - **File chạm:** [README.md](../../README.md), [CLAUDE.md](../../CLAUDE.md), [apps/desktop/ui/README.md](../../apps/desktop/ui/README.md), [docs/design/tray-and-notifications.md](../design/tray-and-notifications.md), [docs/features/tray-account-usage.md](./tray-account-usage.md)
  - **AC references:** Dependencies / ADR 0039 §Cập nhật tài liệu
  - **Owner:** developer
  - **Ước lượng:** S
  - **Depends on:** T8, T9
  - **Acceptance:** Docs cập nhật, link chéo đúng, tiếng Việt; KHÔNG nhồi vào task code.

---

## Task ordering (DAG + critical path)

Mũi tên `>` = depends on. `[P]` = song song được. `*` = nằm trên critical path.

```
Time ──────────────────────────────────────────────────────────────────────>

Nhánh A — Sidecar (độc lập, song song B/C/D)
  T1 [S staleness-guard]
    └> T2 [M Codex ping] ──────────────────────────┐
                                                    │
Nhánh B — Renderer                                  │
  T3 [M trích composable] [P] ─┐                    │
  T4 [S types payload] [P] ────┼─> T5* [M fan-out+sanitize] ─┐
                               │        ^                     │
Nhánh C — IPC                  │        │ (cần T6 bridge)     │
  T4 ──> T6* [S 2 channel] ────┴────────┘                     │
                                                              │
Nhánh D — Electron main                                       │
  T6 ──> T7* [S tách tray.ts]                                 │
            └> T8* [M submenu/icon] <── T5 ───────────────────┤
                  ├> T9* [M notification throttle]            │
                  └> T10 [S trigger wiring] (cần T6 + T8)      │
                                                              │
Nhánh E — Settings                                            │
  T4 + T5 ──> T11 [S gate notificationsEnabled] [P]           │
                                                              │
Nhánh F — Tests/QA/Docs                                       │
  T2 + T5 ──> T12 [M unit test]                               │
  T2 + T5 + T9 ──> T13 [S infosec]                            │
  T9 + T10 + T11 + T12 ──> T14 [M manual TS pass] <───────────┘
  T8 + T9 ──> T15 [S docs]
```

**Critical path (1 dòng):** `T4 → T6 → T7 → T8 → T9 → T14` (types → IPC channel → tách tray.ts → submenu/icon → notification → QA pass). Nhánh A (`T1 → T2`) và B (`T3 → T5`) feed vào nhưng chạy **song song** với nhau và với đầu critical path; T5 phải xong trước T8.

**Song song hóa khuyến nghị (3 luồng dev):**
- Luồng 1 (sidecar): T1 → T2 → (feed T12).
- Luồng 2 (renderer): T4 → T3 → T6 → T5 → T11.
- Luồng 3 (main): chờ T6 → T7 → T8 → T9 → T10.
- Hợp lưu: T12/T13 → T14 → T15.

---

## Definition of Done (chung mọi task code)

- `cd apps/desktop/ui && pnpm lint:fix && pnpm format && pnpm lint` (0 error) + `pnpm typecheck` xanh cho phần UI.
- Sidecar + Electron: typecheck/build script tương ứng của package xanh (KHÔNG tắt `strict`, KHÔNG `any`, KHÔNG `@ts-ignore`).
- **Invariant #1 verified bằng inspect payload thật:** `tray:setState` + notification body KHÔNG chứa token/key/email/UUID/request-ID/raw body (T13 hard-gate; mọi PR chạm payload phải self-check).
- **Không pollute session JSONL khi ping:** Codex ping KHÔNG tạo session/transcript/trace/event UI (T2 + T12 assert).
- **Không timer nền:** verify KHÔNG có `setInterval`/poller chạy khi app idle (T10 + TS-1).
- Theme color (phía renderer) qua `useTheme()`; main map status→symbol bằng hằng nhỏ (menu native không có theme — OQ-4).
- Commit nhỏ một mục đích, title imperative tiếng Anh; tách deps/refactor/feature.

---

## Rủi ro & chỗ khó

- **R-1 (trigger per-OS — T8/T10/T14):** Electron `Tray` không có event "menu sắp mở" đáng tin. macOS left-click mở menu ngay → state về **sau** khi menu dựng → lần mở hiện tại stale (cần dòng "Cập nhật lúc HH:MM"). Win/Linux right-click context-menu khác hành vi. Chấp nhận theo Non-goal nhưng **bắt buộc test ≥2 nền** (T14). Đây là chỗ dễ lệch nhất.
- **R-2 (ping min-token — T2):** Một số provider/backend từ chối `max_tokens < N`. Mitigate bằng fallback bậc thang 1→16→bỏ (ADR 0039 đã chốt). Header rate-limit thường vẫn về kèm response dù output token bị giới hạn → 1 token đủ nạp snapshot. KHÔNG retry tiếp sau 16.
- **R-3 (fan-out rate-limit — T5):** `/api/oauth/usage` của claude.ai rate-limit mạnh. Phải gọi **tuần tự** + `force=false` (tái dùng cache 60s/account) + debounce trigger ≤1 fetch/60s ở main. Vô tình `force=true` hoặc parallel sẽ gây 429. Lỗi 1 account → đánh unavailable + tiếp tục, KHÔNG retry aggressive.
- **R-4 (icon overlay per-OS — T8):** macOS giữ `setTemplateImage` cho base nhưng overlay state KHÔNG template (để giữ màu amber/đỏ); Win/Linux dùng nativeImage thường. Cần asset/programmatic overlay + test 3 nền.
- **R-5 (`tray.ts` phình state — T7/T8/T9):** Module gom dedupe state + icon state + menu builder + trigger. SRP: tách helper map status→symbol + dedupe state thành function thuần trong cùng module, giữ comment. Nếu vượt ~250 dòng cân nhắc tách `tray-notify.ts` riêng.
- **R-6 (`notificationsEnabled` xuống main — T11):** Flag ở renderer, notification ở main. Đề xuất đính vào `TraySetStatePayload` (renderer là source-of-truth theo fetch) — nếu chốt cách này thì T4 types phải thêm field. Cần TL xác nhận cơ chế trước khi code T9/T11.

## Missing from spec

Không có gap chặn. Spec đã khoá 12 AC + 19 TS + tất cả OQ. Các điểm cần TL xác nhận **cơ chế** (không phải gap scope) đã capture trong Risks:
- R-6: cơ chế truyền `notificationsEnabled` xuống main (đính payload vs kênh riêng) — đề xuất đính payload, TL chốt khi code T9/T11.
- Vị trí khai type `TraySetStatePayload` dùng chung renderer↔preload (T4) — mirror pattern `UpdateEvent` (preload có bản mirror cục bộ). Không phải gap, chỉ là quyết định nhỏ TL/dev tự quyết khi code.
- OQ-2 (icon priority hợp nhất đợt tray) hoãn nhưng có mặc định AC-9 đủ để code T8 — KHÔNG chặn.
