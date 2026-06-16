# Feature: Account Quota Usage trên System Tray

> **Trạng thái:** Ready for PM — tất cả Open question đã chốt (OQ-1/3/4/8 qua ADR 0039; OQ-5/6/7/9/10 PO chốt 2026-06-16; OQ-2 hoãn, không chặn)
> **Owner:** Business Analyst
> **Ngày:** 2026-06-15 (PO decisions locked 2026-06-16)
> **Brief nguồn:** [tray-account-usage.brief.md](./tray-account-usage.brief.md) (decisions locked 2026-06-15)
> **Reactive counterpart (đừng trùng):** [connection-quota-handling.md](./connection-quota-handling.md)
> **Design tham chiếu:** [tray-and-notifications.md](../design/tray-and-notifications.md) (UX tray/notification — còn ngôn ngữ thời Tauri, spec này map sang Electron)
> **ADR kỹ thuật:** [0039 — Tray account-usage channel](../decisions/0039-tray-account-usage-channel.md) (chốt OQ-1/3/4/8 — phần kỹ thuật).

## Overview

Hiển thị **quota usage của từng account** ngay trên system tray của AWOG (Electron): tooltip + submenu liệt kê mọi account với % bucket (5h + weekly), countdown reset, và đổi màu icon tray + bắn native notification khi account chạm ngưỡng cảnh báo (≥90%) hoặc bị reject. Đây là tính năng **proactive** (nhìn trước để giãn việc) — bổ sung, không thay thế, luồng **reactive** `waiting_connection` của [connection-quota-handling](./connection-quota-handling.md).

Hạ tầng usage đã có sẵn:
- RPC [`account.usage`](../../apps/desktop/sidecar/src/methods/account.usage.ts) (Anthropic OAuth: cache 60s/account; Codex: đọc snapshot in-memory; API-key/custom: trả rỗng "không khả dụng").
- Logic màu / countdown / label trong [`SessionContextStatus.vue`](../../apps/desktop/ui/components/session/SessionContextStatus.vue) (`utilizationColor`, `formatResetsIn`, `RATE_LIMIT_LABELS`).
- Codex capture passively từ header `x-codex-*-used-percent` qua `onResponse` ([`recordCodexUsageFromHeaders`](../../apps/desktop/sidecar/src/providers/openai/usage.ts)).

Phần mới: loop multi-account khi mở tray + focus → đẩy snapshot sanitized xuống Electron main qua channel mới `tray:setState` → main render submenu/tooltip/icon + bắn notification; thêm nhánh **Codex usage ping** trong sidecar (call rẻ nạp snapshot khi snapshot thiếu/cũ, không ghi transcript).

## Mục tiêu

- Submenu tray liệt kê **tất cả** account; account OAuth/subscription hiện đúng % bucket 5h + weekly, cập nhật khi **mở menu tray + window focus** (KHÔNG timer nền).
- Tray icon đổi sang amber khi account active ≥90%, đỏ khi `rejected` (tái dùng ngưỡng `allowed_warning` / `rejected`).
- Bắn native notification (qua Electron **main**) khi một account chạm ≥90% hoặc `rejected`, có throttle / không lặp.
- Account Codex hiện được số nhờ sidecar ping một call rẻ nạp snapshot khi snapshot thiếu/cũ; ping **không** ghi vào transcript/JSONL session nào.
- Account không có usage (API key / custom endpoint) hiện "không khả dụng" rõ ràng — KHÔNG báo lỗi.
- Token (access token) KHÔNG rời sidecar (invariant #1): main không cầm token, không tự gọi provider endpoint.

## Non-goals

- **Timer/poller nền** khi app đang mở — đã chốt chỉ refresh khi mở menu + focus (Resolved decision #1).
- Usage cho account **API key** (provider không expose endpoint quota) — hiện "không khả dụng".
- Biểu đồ lịch sử / dự báo thời điểm cạn quota.
- Multi-key pool / auto-rotate (out of scope, xem [connection-quota-handling](./connection-quota-handling.md)).
- **Minimize-to-tray** (đề xuất tray #5) — KHÔNG chặn; giai đoạn 1 chấp nhận tray usage chỉ tươi khi app đang mở.
- Auto pause/resume task khi quota cạn — đó là phạm vi reactive của `connection-quota-handling`.

## Personas

- **Solo Builder** (persona chính MVP) — chạy session/task local bằng subscription của chính mình (vd Max chính + Codex phụ), thường có ≥1 account. Gặp problem hằng ngày khi cửa sổ 5h dễ chạm trần. Workaround hiện tại: mở từng session bấm popover đoán, hoặc chạy tới khi bị reject mới biết.

## User flows

### Flow A — Mở menu tray xem usage tất cả account

```
1. App đang mở (window focus). User click tray icon (hoặc right-click → context menu).
2. Renderer nhận tín hiệu "tray opening + focus" → gọi accounts.list → fan-out account.usage
   tuần tự cho mỗi account OAuth/subscription (tận dụng cache 60s/account của sidecar).
3. Account API-key / custom endpoint: skip RPC, đánh dấu "không khả dụng".
4. Account Codex chưa có snapshot hoặc snapshot cũ: sidecar tự ping (Flow C) trong cùng RPC.
5. Renderer gom kết quả → sanitize → gửi tray:setState xuống main.
6. Main rebuild submenu: mỗi account 1 entry với % bucket 5h, % weekly, màu theo status, countdown reset.
7. Main cập nhật tooltip (account active + % cao nhất) + icon state (Flow B nếu có warning/rejected).
```

### Flow B — Account chạm ≥90% (hoặc rejected) → notification → click → focus app

```
1. Trong Flow A, một account có bucket status = allowed_warning (≥90%) hoặc rejected (≥100%).
2. Main đánh giá throttle/dedupe (xem AC-7): nếu chưa notify cho account+bucket+ngưỡng này
   VÀ window KHÔNG đang focus (PO chốt OQ-6: im khi focus) → bắn Notification.
   - title: "AWOG — Quota gần cạn" (warning) / "AWOG — Quota đã cạn" (rejected)
   - body: "{Account label} ({plan}) {bucket label}: {pct}%." (KHÔNG email, KHÔNG token, KHÔNG raw error)
3. Icon tray đổi amber (warning) hoặc đỏ (rejected), gộp với tray-state task hiện có theo priority (AC-9).
4. User click notification → main chỉ **show + focus** window (PO chốt OQ-10: không deeplink).
   KHÔNG điều hướng tới route/account cụ thể.
```

### Flow C — Account Codex chưa có snapshot → ping → hiển thị

```
1. Renderer gọi account.usage(provider=openai, accountId) trong fan-out Flow A.
2. Sidecar: account.authMode === 'oauth' (Codex/ChatGPT subscription).
   - getCodexUsage(accountId) trả snapshot. Nếu null (chưa turn nào) HOẶC capturedAt quá cũ (> TTL):
     → sidecar ping một completeSimple rẻ (max-token tối thiểu) với onResponse=recordCodexUsageFromHeaders.
     → ping KHÔNG ghi vào transcript/JSONL session nào; token ở nguyên sidecar.
   - Nếu snapshot còn tươi (capturedAt trong TTL) → trả luôn, KHÔNG ping.
3. Sau ping, đọc lại snapshot → trả usage. Nếu ping thất bại/timeout → trả usage rỗng "không khả dụng" (KHÔNG throw).
4. Renderer render account Codex như account thường.
```

### Flow D — Account API-key / custom endpoint → "không khả dụng"

```
1. Renderer fan-out gặp account authMode !== 'oauth' (API key, custom baseURL).
2. account.usage trả { profile: null, usage: [], cachedAt } — không lỗi.
3. Renderer đánh dấu account "không khả dụng" trong payload tray:setState.
4. Submenu hiển thị account với label phụ "Usage không khả dụng" (italic/dim), KHÔNG % và KHÔNG icon cảnh báo.
```

## Acceptance Criteria

### AC-1 — Cadence: chỉ refresh khi mở menu tray + focus

- **Given** app đang mở và window focus
  **When** user mở tray (left-click trên macOS / right-click context menu trên mọi nền)
  **Then** renderer fetch usage cho mọi account 1 lần và đẩy `tray:setState` xuống main.
- **Given** window KHÔNG focus (vd đang ở app khác) HOẶC app đang minimize
  **When** chu kỳ thời gian trôi qua
  **Then** renderer KHÔNG tự fetch usage; KHÔNG có timer/poller nền chạy. (Snapshot tray giữ giá trị lần fetch gần nhất, có thể stale — chấp nhận theo Non-goal.)
- **Given** không có cơ chế bắt sự kiện "tray về mở" trực tiếp từ renderer
  **When** TL quyết định trigger
  **Then** dùng tín hiệu thay thế: `window 'focus'` event + (nếu khả thi) `tray.on('click')` / menu open → main gửi tín hiệu `tray:requestUsage` xuống renderer để renderer fetch và trả `tray:setState`. (Chi tiết cơ chế trigger là Open question OQ-3.)

### AC-2 — Submenu liệt kê tất cả account

- **Given** workspace có N account thuộc nhiều provider
  **When** tray submenu render
  **Then** submenu liệt kê **tất cả** N account (không chỉ account active), mỗi account 1 entry, nhóm/đánh dấu account active rõ ràng (vd dấu ✓ hoặc badge "active").
- **Given** account là OAuth/subscription Anthropic
  **Then** entry hiển thị: label account + plan (vd "max") + % bucket 5h + % weekly + countdown reset.
- **Given** account là Codex OAuth
  **Then** entry hiển thị % bucket five_hour (primary) + seven_day (secondary) + countdown reset (sau khi có snapshot — Flow C).
- **Given** account API-key/custom
  **Then** entry hiển thị label + "Usage không khả dụng", KHÔNG %.

### AC-3 — Render % + màu + countdown reset

- **Given** một bucket có `utilization` ∈ [0,1]
  **Then** hiển thị `Math.round(utilization * 100)%` (mirror `SessionContextStatus.vue`).
- **Given** bucket status
  **Then** màu/label theo ngưỡng tái dùng: `allowed` (< 0.9) = neutral/accent, `allowed_warning` (≥ 0.9) = amber, `rejected` (≥ 1.0) = đỏ. KHÔNG hardcode hex mới — dùng theme token (Electron menu không có theme context, nên main map status → emoji/ký hiệu hoặc prefix text, vd "⚠" / "✕"; chi tiết render menu là OQ-4).
- **Given** bucket có `resetsAt` (ms epoch)
  **Then** hiển thị countdown rút gọn theo `formatResetsIn` (m / h / d; "now" khi đã reset). Nếu thiếu `resetsAt` → bỏ countdown.
- **Given** label bucket
  **Then** dùng `RATE_LIMIT_LABELS` (5-hour limit / Weekly · all / Weekly · Opus / Weekly · Sonnet / Overage).

### AC-4 — Status mapping (allowed / warning / rejected)

- **Given** usage entry từ sidecar
  **Then** renderer KHÔNG tự tính lại status; dùng `entry.status` do sidecar cấp (`allowed` | `allowed_warning` | `rejected`) — single source of truth, mirror Anthropic + Codex usage helper.
- **Given** một account có nhiều bucket với status khác nhau
  **Then** status tổng hợp của account = **xấu nhất** trong các bucket (`rejected` > `allowed_warning` > `allowed`). Status tổng hợp này drive màu icon + notification.

### AC-5 — Fan-out tuần tự, tôn trọng cache 60s

- **Given** N account OAuth/subscription
  **When** renderer fan-out `account.usage`
  **Then** gọi **tuần tự** (hoặc giới hạn concurrency ≤ 1–2) để không vượt cache rate-limit của `/api/oauth/usage`; KHÔNG `force: true` (để tái dùng cache 60s/account của sidecar).
- **Given** sidecar trả `cachedAt` trong vòng 60s
  **Then** renderer dùng kết quả cache, KHÔNG ép sidecar gọi lại endpoint claude.ai.
- **Given** fan-out gặp lỗi cho 1 account
  **Then** account đó đánh dấu "không khả dụng" và fan-out **tiếp tục** các account còn lại (không fail toàn cục).

### AC-6 — Notification trigger

- **Given** Flow A hoàn tất và một account có status tổng hợp = `allowed_warning` (≥90%) hoặc `rejected`
  **When** main đánh giá trigger
  **Then** main bắn 1 native `Notification` (qua Electron main, KHÔNG qua Chromium renderer) với:
  - title: warning → "AWOG — Quota gần cạn"; rejected → "AWOG — Quota đã cạn".
  - body: "{Account label} ({plan}) {bucket label}: {pct}%." — label do user đặt + plan, **KHÔNG email** (PO chốt OQ-7), KHÔNG token, KHÔNG raw error, KHÔNG request ID.
- **Given** status tổng hợp của account = `allowed` (< 90%)
  **Then** KHÔNG bắn notification cho account đó.
- **Given** `settings.notificationsEnabled === false`
  **Then** KHÔNG bắn notification (chỉ đổi icon + submenu). (Tái dùng flag đã có; xem [connection-quota-handling AC-10](./connection-quota-handling.md).)

### AC-7 — Notification throttle / không lặp

- **Given** một account đã được notify ở ngưỡng `allowed_warning`
  **When** lần fetch kế tiếp account vẫn ở `allowed_warning` (cùng ngưỡng)
  **Then** KHÔNG bắn lại — dedupe theo khóa `{accountId, bucket?, level}` với `level ∈ {warning, rejected}`.
- **Given** account đã notify `allowed_warning` rồi leo lên `rejected`
  **When** fetch kế tiếp
  **Then** bắn 1 notification mới (escalation: rejected là level mới, KHÔNG bị dedupe bởi warning).
- **Given** account đã reset về `allowed` (< 90%) rồi sau đó lại leo lên ≥ 90%
  **When** fetch phát hiện vượt ngưỡng lần nữa
  **Then** dedupe state cho account đó được **clear khi xuống dưới 90%** → cho phép notify lại lần leo mới.
- **Given** nhiều account cùng vượt ngưỡng trong một lần fetch
  **When** main bắn notification
  **Then** gộp thành 1 notification "N account gần cạn quota" thay vì N notification (mirror quy tắc batch của [tray design](../design/tray-and-notifications.md#quy-tắc-không-spam); ngưỡng gộp **N ≥ 2** — PO chốt OQ-5).
- **Given** window đang focus
  **When** account vượt ngưỡng
  **Then** **KHÔNG** bắn notification (PO chốt OQ-6: im khi focus, đồng nhất quy tắc task-event của tray design). Vẫn cập nhật icon + submenu. Notification chỉ bắn khi app ở nền/ẩn.

### AC-8 — Codex ping + staleness-guard + không pollute transcript

- **Given** account.usage(openai) với account Codex OAuth, snapshot null hoặc `capturedAt` cũ hơn TTL
  **When** RPC chạy
  **Then** sidecar ping 1 `completeSimple` rẻ (max-token tối thiểu) với `onResponse = recordCodexUsageFromHeaders`, KHÔNG truyền tool, rồi đọc lại `getCodexUsage`.
- **Given** snapshot Codex còn tươi (`capturedAt` trong TTL)
  **When** RPC chạy
  **Then** sidecar trả snapshot luôn, **KHÔNG** ping (staleness-guard).
- **Given** ping chạy
  **Then** call KHÔNG được ghi vào bất kỳ session JSONL / transcript / trace nào; KHÔNG tạo message; KHÔNG emit event lên UI. Token ở nguyên sidecar.
- **Given** ping thất bại hoặc timeout
  **Then** RPC trả `{ usage: [], cachedAt }` ("không khả dụng"), KHÔNG throw (usage là best-effort panel).
- **Con số đã chốt (TL, ADR 0039):**
  - **TTL snapshot "cũ":** 5 phút (300_000 ms) — đủ tươi cho cadence mở-menu thưa, đủ lâu để 1 phiên chạy nhiều session không ping liên tục.
  - **max-token ping:** 1, **fallback bậc thang 1 → 16 → bỏ ping** (trả unavailable, không throw) nếu provider từ chối min-token. Prompt ping cực ngắn ("ping"); reuse path `completePi` (no-tools, đã có `onResponse`).

### AC-9 — Icon priority (gộp usage với tray-state task)

- **Given** tray icon đã có state từ task (`Failed > Waiting Approval > Running > Idle` — [tray design](../design/tray-and-notifications.md#trạng-thái-tray-icon))
  **When** thêm usage state (`usage_rejected`, `usage_warning`)
  **Then** thứ tự priority đề xuất (cao → thấp):
  `Failed > Usage Rejected > Waiting Approval > Usage Warning > Running > Idle`.
  Lý do: usage `rejected` chặn việc giống Failed (nhưng task chưa fail) → ngay dưới Failed; usage warning là cảnh báo mềm → dưới Waiting Approval, trên Running.
  > Thứ tự này là **đề xuất BA**, cần TL/PO chốt khi hợp nhất với các đề xuất tray khác — OQ-2.
- **Given** không có usage warning/rejected
  **Then** icon giữ nguyên state task hiện có (feature này không thay đổi behavior task).

### AC-10 — Account không có usage

- **Given** account authMode !== 'oauth' (API key, custom endpoint)
  **When** fan-out
  **Then** entry hiển thị "Usage không khả dụng", KHÔNG % và KHÔNG icon cảnh báo, KHÔNG báo lỗi, KHÔNG đếm vào trigger notification.

### AC-11 — Token KHÔNG leak (invariant #1)

- **Given** payload `tray:setState` đi từ renderer → main
  **Then** payload **chỉ** chứa field sanitized (xem [Data shape](#data-shape-payload-trayssetstate)): KHÔNG access token, KHÔNG refresh token, KHÔNG apiKey, KHÔNG raw response body, KHÔNG request ID, KHÔNG organization UUID.
- **Given** main render submenu/tooltip/notification
  **Then** main KHÔNG tự gọi `/api/oauth/usage` hay bất kỳ provider endpoint nào; main chỉ tiêu thụ snapshot đã sanitized do renderer đẩy xuống.
- **Given** notification body
  **Then** chỉ chứa label account (do user đặt) + plan + bucket label + %; KHÔNG fragment token/key.

### AC-12 — Restart / lifecycle

- **Given** app vừa khởi động, chưa lần fetch nào
  **When** tray render lần đầu trước khi có `tray:setState`
  **Then** submenu hiển thị placeholder ("Đang tải usage…" hoặc ẩn section usage), icon giữ state task, KHÔNG crash.
- **Given** Codex snapshot in-memory mất sau restart sidecar
  **When** Flow A chạy sau restart
  **Then** snapshot null → ping (Flow C) nạp lại — đúng AC-8.

## Data shape (payload `tray:setState`)

Payload renderer → main. **Sanitized — KHÔNG token/key.** TypeScript (định nghĩa cuối do TL chốt cùng channel):

```ts
// Mỗi bucket usage đã sanitize (mirror UsageEntry nhưng chỉ field hiển thị).
type TrayUsageBucket = {
  rateLimitType: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage'
  utilization: number // 0..1
  status: 'allowed' | 'allowed_warning' | 'rejected'
  resetsAt?: number // ms epoch
}

type TrayAccountUsage = {
  accountId: string // id nội bộ (không nhạy cảm), khóa định danh entry submenu
  provider: 'anthropic' | 'openai' | 'google'
  label: string // tên account user đặt (AccountSafe.label)
  plan?: string // profile.subscriptionType, vd 'max' | 'pro' (Anthropic); undefined nếu không có
  available: boolean // false ⇒ API-key/custom/lỗi ⇒ "không khả dụng"
  isActive: boolean // account active của provider
  overallStatus: 'allowed' | 'allowed_warning' | 'rejected' | 'unavailable'
  buckets: TrayUsageBucket[] // rỗng khi !available
}

type TraySetStatePayload = {
  accounts: TrayAccountUsage[]
  fetchedAt: number // ms epoch — để main hiển thị "cập nhật N phút trước" nếu cần
}
```

**KHÔNG bao giờ** xuất hiện trong payload: `accessToken`, `refreshToken`, `apiKey`, `oauth`, `piOAuth`, `organizationUuid`, `accountUuid`, `email`, raw response body, provider request ID.

> Lưu ý: `accountId` là id local (vd uuid/slug do AWOG sinh), không phải secret — chỉ dùng làm khóa định danh entry submenu (click chỉ focus app, không deeplink — OQ-10). `email` đã **loại** khỏi payload + notification (PO chốt OQ-7: chỉ `label` + `plan`).

## Edge cases

| Edge case | Hành vi mong muốn |
|---|---|
| Nhiều account cùng vượt ngưỡng trong 1 lần fetch | Gộp thành 1 notification "N account gần cạn quota" (AC-7). Ngưỡng gộp N — OQ-5. |
| Reset xảy ra khi menu đang mở | Submenu hiển thị giá trị tại thời điểm fetch (snapshot). KHÔNG live countdown trong menu (Electron menu tĩnh); user mở lại menu để refresh. Chấp nhận stale ngắn. |
| Sidecar unavailable | `accounts.list` / `account.usage` fail → renderer gửi `tray:setState` với `accounts: []` hoặc giữ snapshot cũ; submenu hiển thị "Engine chưa sẵn sàng"; KHÔNG crash, KHÔNG notification. |
| Account bị xóa khi menu đang mở | Submenu là snapshot — entry account đã xóa vẫn hiện tới lần fetch kế. Click chỉ focus app (không deeplink — OQ-10) → vô hại. KHÔNG crash. |
| Codex ping thất bại / timeout | Trả usage rỗng "không khả dụng" (AC-8), KHÔNG throw, KHÔNG notification. Lần fetch sau thử ping lại (snapshot vẫn null/cũ). |
| App vừa khởi động chưa có snapshot nào | Placeholder "Đang tải usage…" (AC-12); Codex ping nạp khi Flow A chạy lần đầu. |
| Rate-limit 429 khi fan-out nhiều account | `account.usage` cho account đó throw → fan-out đánh dấu account "không khả dụng" và tiếp tục (AC-5). Vì gọi tuần tự + tái dùng cache 60s, xác suất 429 thấp. KHÔNG retry aggressive ở renderer. |
| Window focus liên tục (alt-tab nhiều) | Debounce trigger fetch (vd ≤ 1 fetch / 60s tổng, đồng bộ với cache TTL) để không hammer; cache sidecar 60s cũng đã hấp thụ. (Chi tiết debounce — OQ-3.) |
| User tắt `notificationsEnabled` | KHÔNG notification, nhưng vẫn đổi icon + submenu (AC-6). |
| Provider trả usage rỗng nhưng account OAuth hợp lệ (endpoint rate-limited tạm) | Coi như "không khả dụng" tạm thời cho lần fetch này; lần sau thử lại. KHÔNG notification (overallStatus = unavailable). |

## Dependencies

### Hạ tầng đã có (tái dùng)

- RPC [`account.usage`](../../apps/desktop/sidecar/src/methods/account.usage.ts) — Anthropic cache 60s; Codex snapshot; API-key/custom trả rỗng. (Cần mở rộng nhánh Codex để **ping** khi stale — xem phần mới.)
- RPC [`accounts.list`](../../apps/desktop/sidecar/src/methods/accounts.list.ts) — liệt kê account sanitized (`AccountSafe`) để fan-out.
- [`recordCodexUsageFromHeaders` / `getCodexUsage`](../../apps/desktop/sidecar/src/providers/openai/usage.ts) — capture/đọc snapshot Codex.
- `completeSimple(... { onResponse })` (xem [`runtime/complete.ts`](../../apps/desktop/sidecar/src/runtime/complete.ts)) — path one-shot tái dùng cho Codex ping (không tool, không session).
- Logic màu/countdown/label trong [`SessionContextStatus.vue`](../../apps/desktop/ui/components/session/SessionContextStatus.vue) — trích ra composable dùng chung.
- Pattern renderer-drive + main-reactive của [`updater.ts`](../../apps/desktop/electron/src/updater.ts) (`webContents.send` + dedicated channel) — mẫu cho `tray:setState`.
- `settings.notificationsEnabled` ([settings.ts](../../apps/desktop/ui/stores/settings.ts)) — gate notification.

### Phần mới

- **IPC channel `tray:setState`** (renderer → main) + `tray:requestUsage` (main → renderer, trigger fetch) — bổ sung vào [`preload.ts`](../../apps/desktop/electron/src/preload.ts) (`window.awog.setTrayState` + `onTrayRequestUsage`), [`ipc.ts`](../../apps/desktop/electron/src/ipc.ts) hoặc module tray riêng. KHÔNG đi qua `engine:request` (đây là renderer↔main, không phải engine).
- **Module tray** trong Electron main (tách `setupTray` ở [`main.ts`](../../apps/desktop/electron/src/main.ts) thành `tray.ts`): build dynamic submenu, tooltip, icon-state, notification + throttle/dedupe state, click → chỉ focus window.
- **Native notification ở main** (`new Notification(...)` của Electron) — chuyển notify usage sang main (trùng hướng đề xuất tray #3 của design doc). Click handler → chỉ focus window (không navigate — OQ-10).
- **Codex usage ping path** trong sidecar — mở rộng nhánh `provider === 'openai'` của `account.usage`: staleness-guard + `completeSimple` rẻ + đọc lại snapshot, áp dụng cho **mọi** Codex OAuth account stale (PO chốt OQ-9). KHÔNG ghi session.
- **Composable `useAccountUsage()`** (renderer) — trích logic usage từ `SessionContextStatus.vue` (Rule of Three: popover + tray; sau này dùng cho Settings → Models & Accounts). Orchestrate fan-out `accounts.list` + `account.usage`, sanitize → `TraySetStatePayload`. Không `import fs`/SDK (đi qua sidecar IPC).

### Entity liên quan

- **Account** (`AccountRecord` / `AccountSafe` — [shared.ts](../../apps/desktop/sidecar/src/types/shared.ts)): `authMode` quyết định OAuth vs API-key; `label`, `id`, active status.
- **Session / Task**: feature này KHÔNG thay đổi behavior của chúng; chỉ đọc account. Codex ping KHÔNG tạo session/transcript.
- **Settings**: `notificationsEnabled` (gate notification). Không cần deeplink target (OQ-10: click chỉ focus).

## Open questions

| ID | Câu hỏi | Cho ai | Trạng thái |
|---|---|---|---|
| OQ-1 | Có cần **ADR mới** cho channel `tray:setState` + chuyển native notification sang main? | TL | **CHỐT (ADR 0039):** CÓ. Cặp channel riêng tách `engine:event`/`updater:event`; renderer-drive + main-reactive; shape sanitized; Codex ping ở sidecar. |
| OQ-2 | **Icon priority** chính xác khi hợp nhất với các đề xuất tray khác (badge cần-duyệt, dynamic menu task)? | TL + PO | **HOÃN (defer):** dùng `Failed > Usage Rejected > Waiting Approval > Usage Warning > Running > Idle` (AC-9) làm mặc định; chốt lại khi triển khai chung đợt tray (các đề xuất tray kia chưa làm). Không chặn feature này. |
| OQ-3 | **Cơ chế trigger** fetch chính xác: Electron `Tray` không có event "menu sắp mở" đáng tin. | TL | **CHỐT (ADR 0039):** main proxy signal `tray.on('click')` + window `'focus'` (+ `right-click` best-effort) → debounce ≤1 fetch/60s → `tray:requestUsage`. Menu hiện snapshot gần nhất + dòng "Cập nhật lúc HH:MM". |
| OQ-4 | **Cách render status trong native menu** (Electron `Menu` không có theme/HTML). | TL + designer | **CHỐT (ADR 0039):** text + ký hiệu unicode (⚠/✕/✓), 1 dòng/account ở menu gốc + submenu con/bucket; icon-state qua overlay nativeImage. |
| OQ-5 | **Ngưỡng gộp notification** khi nhiều account cùng vượt: N ≥ 2 hay ≥ 3? | PO | **CHỐT:** N ≥ 2 (gộp khi từ 2 account trở lên cùng vượt trong 1 fetch). |
| OQ-6 | Notification usage có **bắn khi window đang focus** không? | PO | **CHỐT:** KHÔNG — im khi focus, đồng nhất task-event của tray design. Chỉ bắn khi app ở nền/ẩn (AC-7, TS-5b). |
| OQ-7 | Notification/menu có **hiện email/label account** không? | PO + infosec | **CHỐT:** hiện `label` (user đặt) + `plan`, **ẩn email**. Email loại khỏi cả payload `tray:setState` lẫn notification body (AC-11, TS-14). |
| OQ-8 | **TTL snapshot Codex** + **max-token ping**. | TL | **CHỐT (ADR 0039):** TTL 5 phút; max-token ping 1, fallback bậc thang 1→16→bỏ (không throw). |
| OQ-9 | Codex ping **chỉ account active** thay vì mọi Codex account? | PO + TL | **CHỐT:** ping **mọi** Codex OAuth account stale (staleness-guard 5 phút + max-token 1 giữ chi phí cực nhỏ). |
| OQ-10 | Click notification deeplink tới **Settings → Models & Accounts** hay session/task? | PO | **CHỐT:** KHÔNG deeplink — click chỉ show + focus window. Gỡ phần deeplink/route highlight khỏi scope (Flow B, Dependencies). |

## Test scenarios (input cho QA)

- **TS-1 (cadence):** Mở tray khi focus → fetch 1 lần. Để app mất focus 5 phút → KHÔNG fetch nền, KHÔNG request thêm tới claude.ai.
- **TS-2 (all-account):** 3 account (Max OAuth, Codex OAuth, 1 API-key) → submenu liệt kê đủ 3; API-key hiện "không khả dụng".
- **TS-3 (render):** Account Max ở 92% bucket 5h → submenu hiện "92%" + màu amber + countdown reset đúng định dạng (m/h/d).
- **TS-4 (status):** Bucket utilization 1.0 → status `rejected` → icon đỏ; 0.95 → `allowed_warning` → amber; 0.5 → `allowed` → neutral.
- **TS-5 (notification trigger):** App ở nền (không focus), account leo lên 91% → 1 notification "Quota gần cạn". Account lên 100% → 1 notification "Quota đã cạn".
- **TS-5b (im khi focus — OQ-6):** Window đang focus, account leo lên 91% → KHÔNG notification; icon + submenu vẫn cập nhật amber. Mất focus rồi vượt ngưỡng → có notification.
- **TS-6 (throttle):** Account ở 91% qua 2 lần mở menu liên tiếp → chỉ 1 notification (dedupe). Leo 91% → 100% → notification mới (escalation).
- **TS-7 (reset re-trigger):** Account 91% → notify → reset về 30% → leo lại 92% → notification mới (dedupe cleared).
- **TS-8 (batch):** 2 account cùng vượt 90% trong 1 fetch → 1 notification gộp "2 account gần cạn quota".
- **TS-9 (Codex ping):** Codex account chưa turn nào → mở tray → sidecar ping → snapshot nạp → submenu hiện %. Verify KHÔNG có session/transcript/trace mới tạo.
- **TS-10 (staleness-guard):** Codex snapshot vừa nạp (< TTL) → mở tray lần 2 trong TTL → KHÔNG ping lại (log không có ping mới).
- **TS-11 (Codex ping fail):** Codex account token hết hạn → ping fail → submenu "không khả dụng", KHÔNG throw, KHÔNG notification.
- **TS-12 (no-usage):** API-key account → "không khả dụng", không đếm vào notification.
- **TS-13 (icon priority):** Có task Failed + account usage rejected → icon = Failed state (Failed > Usage Rejected).
- **TS-14 (security):** Inspect IPC payload `tray:setState` + notification body → KHÔNG có access/refresh token, apiKey, request ID, org UUID, **email** (OQ-7 chốt ẩn email).
- **TS-15 (security):** Đọc log sidecar khi Codex ping → KHÔNG có token; chỉ header NAMES (như `recordCodexUsageFromHeaders` hiện log).
- **TS-16 (click):** Click notification → app **chỉ** show + focus window (OQ-10), KHÔNG navigate route nào.
- **TS-17 (sidecar down):** Kill sidecar → mở tray → submenu "Engine chưa sẵn sàng", KHÔNG crash.
- **TS-18 (fan-out 429):** 1 account trả 429 → đánh dấu "không khả dụng", account còn lại vẫn render.
- **TS-19 (lifecycle):** App vừa mở chưa fetch → submenu placeholder "Đang tải usage…", icon = task state, KHÔNG crash.

## Technical decisions (TL)

> Chốt phần kỹ thuật 2026-06-15 (TL). Chi tiết + phương án đã cân nhắc + impact: [ADR 0039](../decisions/0039-tray-account-usage-channel.md). Các OQ chính sách (OQ-2/5/6/7/9/10) **vẫn chờ PO**.

- **OQ-1 — CÓ tạo ADR ([0039](../decisions/0039-tray-account-usage-channel.md)).** Không phải mở rộng pattern updater thuần: hướng dữ liệu ngược (renderer→main) + dữ liệu bắt nguồn từ provider (đụng invariant #1) + side-effect mới ở sidecar (Codex ping tiêu quota). ADR đóng đinh: cặp channel riêng `tray:setState` (invoke, renderer→main) + `tray:requestUsage` (send, main→renderer), **không** qua `engine:request`; renderer-drive + main-reactive; shape sanitized (KHÔNG token/key/UUID/request-ID/email); nhánh Codex ping ở sidecar.
- **OQ-3 — Trigger = main proxy signal + debounce.** `tray.on('click')` + `BrowserWindow 'focus'` (+ `right-click` best-effort) → main debounce ≤ 1 fetch/60s (đồng bộ cache TTL) → gửi `tray:requestUsage` → renderer fan-out + đẩy `tray:setState`. Hạn chế: native menu tĩnh nên lần mở **hiện tại** dùng snapshot gần nhất, state về cho lần mở **kế tiếp** → menu phải có dòng `"Cập nhật lúc HH:MM"` (từ `fetchedAt`). macOS/Win/Linux cùng cơ chế; chấp nhận stale ngắn (Non-goal).
- **OQ-4 — Render = text + ký hiệu unicode, KHÔNG màu trong menu.** Menu gốc 1 dòng/account: `"{label} · {plan} · 5h {pct}% {⚠|✕} · wk {wkPct}% · reset {countdown}"`, active prefix `✓`, không khả dụng = `"… · usage không khả dụng"`. Submenu con: 1 `MenuItem enabled:false`/bucket (`RATE_LIMIT_LABELS` + % + countdown) + dòng timestamp. Icon-state warning/rejected truyền qua **overlay nativeImage** trên icon tray (không template để giữ màu), priority gộp task-state theo AC-9 (OQ-2 PO chốt). Logic màu/format trích ra composable `useAccountUsage()`; main map `status → symbol` bằng hằng nhỏ (không cần theme).
- **OQ-8 — TTL Codex snapshot = 5 phút (300_000 ms); max-token ping = 1, fallback bậc thang 1→16→bỏ.** Reuse `completePi` (no-tools, đã có `onResponse: recordCodexUsageFromHeaders` — [complete.ts:83-97](../../apps/desktop/sidecar/src/runtime/complete.ts#L83-L97)), prompt `"ping"`. Rủi ro min-token: nếu provider từ chối 1 → thử 16 → vẫn lỗi/timeout thì trả `{ usage: [], cachedAt }` ("không khả dụng"), **không throw**. Header rate-limit thường vẫn về kèm response dù output token bị giới hạn. Staleness-guard: chỉ ping khi snapshot null hoặc `capturedAt > TTL`. KHÔNG ghi session/JSONL/trace.

## Đề xuất tiếp theo

- Spec ở trạng thái **Ready for PM** với các Open question đánh dấu rõ cho PM/TL.
- Bàn giao **Project Manager** (skill `decompose-tasks`) chia theo surface:
  1. **Sidecar** — mở rộng nhánh Codex `account.usage`: staleness-guard + ping `completeSimple` (TTL/max-token theo OQ-8 đã chốt).
  2. **Composable `useAccountUsage()`** — trích từ `SessionContextStatus.vue`, fan-out tuần tự + sanitize → `TraySetStatePayload`.
  3. **Electron main** — `tray.ts`: dynamic submenu + tooltip + icon-state (priority OQ-2) + notification (throttle/dedupe AC-7) + click→focus+navigate.
  4. **IPC channel** — `tray:setState` + `tray:requestUsage` ở `preload.ts` + `ipc.ts`/`main.ts`.
  5. **Deeplink** — Settings → Models & Accounts nhận `?focus=account:<provider>:<accountId>`.
  6. **Trigger wiring** — `window 'focus'` + `tray.on('click')` + debounce (OQ-3 đã chốt).
- **TL** đã chốt OQ-1 (ADR 0039), OQ-3 (trigger), OQ-4 (render), OQ-8 (TTL/max-token). OQ-2 (icon priority) còn chờ PO khi hợp nhất đợt tray.
- **PO** chốt OQ-2/OQ-5/OQ-6/OQ-7/OQ-9/OQ-10 (chính sách notification + privacy + deeplink target + icon priority).

## Liên kết

- [ADR 0039 — Tray account-usage channel](../decisions/0039-tray-account-usage-channel.md)
- [Feature Brief](./tray-account-usage.brief.md)
- [Tray & Notifications design](../design/tray-and-notifications.md)
- [Connection Quota Handling](./connection-quota-handling.md) (reactive counterpart)
- [Models & Accounts](./models-and-accounts.md)
- [VISION](../../artifacts/VISION.md)
- [.claude/rules/security.md](../../.claude/rules/security.md) — invariant #1 (token isolation)
- RPC: [account.usage](../../apps/desktop/sidecar/src/methods/account.usage.ts) · [accounts.list](../../apps/desktop/sidecar/src/methods/accounts.list.ts)
- Provider usage: [anthropic/usage.ts](../../apps/desktop/sidecar/src/providers/anthropic/usage.ts) · [openai/usage.ts](../../apps/desktop/sidecar/src/providers/openai/usage.ts)
- UI hiện tại: [SessionContextStatus.vue](../../apps/desktop/ui/components/session/SessionContextStatus.vue)
- Electron: [main.ts](../../apps/desktop/electron/src/main.ts) · [updater.ts](../../apps/desktop/electron/src/updater.ts) · [ipc.ts](../../apps/desktop/electron/src/ipc.ts) · [preload.ts](../../apps/desktop/electron/src/preload.ts)
