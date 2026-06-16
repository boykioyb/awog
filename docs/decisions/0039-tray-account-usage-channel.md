# 0039 — Tray account-usage state channel (`tray:setState`) + main-side notification

- **Trạng thái:** Accepted — chốt phần kỹ thuật (TL, 2026-06-15); chính sách notification còn phụ thuộc PO (OQ-5/6/7/9/10)
- **Ngày:** 2026-06-15
- **Người quyết định:** Tech Lead (OQ kỹ thuật 1/3/4/8)
- **Liên quan:** [tray-account-usage](../features/tray-account-usage.md) (feature spec) · [tray-account-usage.brief](../features/tray-account-usage.brief.md) · [tray-and-notifications](../design/tray-and-notifications.md) (UX design) · [0028](./0028-auto-update.md) (pattern renderer-drive + main-reactive) · [0008](./0008-stdio-ipc-for-sidecar.md) (stdio JSON-RPC sidecar) · [connection-quota-handling](../features/connection-quota-handling.md) (reactive counterpart)

## Bối cảnh

Feature "Account Quota Usage trên System Tray" ([spec](../features/tray-account-usage.md), [brief](../features/tray-account-usage.brief.md)) cần đẩy **snapshot usage của mọi account** lên Electron tray (submenu + tooltip + icon-state + native notification) khi user mở menu tray và window đang focus. Các quyết định **đã chốt** (brief 2026-06-15): cadence chỉ khi mở-menu + focus (không timer nền); submenu liệt kê tất cả account; notification ở Electron main khi ≥90% / rejected; Codex dùng trick ping (staleness-guard, không ghi transcript, token ở sidecar); không phụ thuộc minimize-to-tray.

Bốn open question **kỹ thuật** cần TL chốt: (OQ-1) có cần ADR cho channel `tray:setState`; (OQ-3) cơ chế trigger fetch khi Electron `Tray` không có event "menu sắp mở" đáng tin; (OQ-4) cách render %/status trong native `Menu` không có theme/HTML; (OQ-8) con số TTL snapshot Codex + max-token ping.

### Ràng buộc định hình quyết định

1. **Invariant #1 — token không rời sidecar.** Khác với `updater:event` (chỉ truyền version metadata của chính app, hướng main→renderer 1 chiều), channel này truyền dữ liệu **bắt nguồn từ provider** (claude.ai usage / Codex header) theo hướng renderer→main. Payload phải được sanitize tuyệt đối: không access/refresh token, apiKey, raw body, request ID, org/account UUID, (và theo OQ-7 có thể cả email).
2. **Sidecar là biên gọi provider duy nhất** ([invariant #4](../../.claude/rules/security.md)). Main **không** được tự gọi `/api/oauth/usage` hay bất kỳ provider endpoint — chỉ tiêu thụ snapshot do renderer đẩy xuống (renderer lấy qua sidecar IPC `account.usage`).
3. **claude.ai rate-limit `/api/oauth/usage`.** RPC `account.usage` đã cache 60s/account ([account.usage.ts](../../apps/desktop/sidecar/src/methods/account.usage.ts)). Fan-out nhiều account không được phá cache đó.
4. **Codex không có GET usage endpoint** — chỉ đọc được rate-limit từ HTTP response header của một model call thật ([openai/usage.ts](../../apps/desktop/sidecar/src/providers/openai/usage.ts)). Snapshot in-memory, mất sau restart. Để nạp snapshot khi panel cần mà chưa có turn nào → phải **ping** một model call rẻ. Ping này **tiêu một lượng quota nhỏ của chính account đang đo** và là side-effect mới mà `account.usage` (hiện thuần read) chưa có.
5. **Electron `Tray` không có "menu sẽ mở" event đáng tin.** macOS render context-menu từ `setContextMenu()` dựng sẵn; không có hook "trước khi hiện". `tray.on('click')` chỉ bắn cho left-click. Không có cách để renderer biết "tray đang mở" trực tiếp.
6. **Electron `Menu`/`MenuItem` không có theme/HTML/màu tùy biến** — chỉ `label` (text), `sublabel`/`toolTip`, `enabled`, `type`, `submenu`, `icon` (per-item image). Logic màu/countdown/label hiện sống trong [SessionContextStatus.vue](../../apps/desktop/ui/components/session/SessionContextStatus.vue) (web, có theme token) — không tái dùng nguyên vẹn cho native menu.

## Quyết định

> Thêm **một cặp channel IPC riêng** cho tray-state (tách khỏi cả `engine:event` của sidecar lẫn `updater:event`), theo đúng pattern renderer-drive + main-reactive của [ADR 0028](./0028-auto-update.md): **renderer là single source of truth của usage data, main thuần reactive render/notify**. Tách logic tray khỏi `main.ts` thành module `tray.ts`. Nhánh Codex ping nằm trong sidecar (`account.usage`), không bao giờ lộ ra ngoài sidecar.

### OQ-1 — CÓ tạo ADR (chính là tài liệu này)

Đây **không** chỉ là mở rộng pattern updater, vì hai lý do chạm giả định core:
- **Hướng dữ liệu ngược + dữ liệu nhạy cảm:** updater đẩy main→renderer metadata vô hại; tray-state đẩy renderer→main dữ liệu bắt nguồn từ provider → đụng **invariant #1**. Cần đóng đinh shape sanitized làm hợp đồng kiểm toán được.
- **Side-effect mới ở sidecar:** Codex ping tiêu quota + là model call không-transcript — thay đổi semantics của `account.usage` từ thuần-read sang có-side-effect-có-điều-kiện. Đây là loại thay đổi bắt buộc ADR theo quy trình TL.

ADR scope **đủ rộng** để làm nền `tray-state channel` cho các đề xuất tray khác (badge cần-duyệt, dynamic menu task — [design doc](../design/tray-and-notifications.md)) tái dùng cùng cặp channel, nhưng quyết định cụ thể giới hạn ở usage feature.

#### IPC contract (renderer ⇄ main) — KHÔNG đi qua `engine:request`

Bổ sung vào [preload.ts](../../apps/desktop/electron/src/preload.ts) + module tray ở main:

| Bridge (`window.awog`) | IPC channel | Hướng | Vai trò |
|---|---|---|---|
| `setTrayState(payload)` | `tray:setState` (invoke) | renderer → main | Đẩy `TraySetStatePayload` đã sanitize; main rebuild submenu/tooltip/icon + đánh giá notification |
| `onTrayRequestUsage(handler)` | `tray:requestUsage` (send) | main → renderer | Main yêu cầu renderer fetch + đẩy state (trigger — xem OQ-3); trả unsubscribe |

> Đây là kênh renderer↔main thuần (giống updater), **không** phải engine call → **không** đi qua `engine:request`. Giữ một biên kiểm toán riêng cho tray.

#### Data shape — sanitized (hợp đồng invariant #1)

Chốt shape ở [spec §Data shape](../features/tray-account-usage.md#data-shape-payload-trayssetstate): `TraySetStatePayload { accounts: TrayAccountUsage[]; fetchedAt }`, mỗi account chỉ chứa `accountId` (id local, không secret), `provider`, `label`, `plan?`, `available`, `isActive`, `overallStatus`, `buckets[]` (mỗi bucket: `rateLimitType`, `utilization` 0..1, `status`, `resetsAt?`). **Cấm tuyệt đối** trong payload: `accessToken`, `refreshToken`, `apiKey`, `oauth`, `piOAuth`, `organizationUuid`, `accountUuid`, `email`, raw response body, provider request ID. Main render từ payload này, **không** tự gọi provider.

### OQ-3 — Cơ chế trigger fetch

Vì không có event "menu sắp mở" đáng tin, dùng **proxy signal** ở main → gửi `tray:requestUsage` xuống renderer; renderer fetch (fan-out) rồi đẩy `tray:setState` về:

- **Main lắng nghe:**
  - `tray.on('click')` (left-click — tin cậy mọi nền; macOS đây cũng là cử chỉ mở menu phổ biến).
  - `tray.on('right-click')` (Win/Linux context-menu) — best-effort; macOS right-click cũng bắn nhưng menu hiện ngay nên kết quả về **sau** khi menu đã dựng (xem hạn chế).
  - `BrowserWindow 'focus'` event — bắt khi user alt-tab lại app.
- **Debounce tổng ≤ 1 fetch / 60s** (đồng bộ với cache TTL 60s của `account.usage`): nhiều click/focus liên tiếp gộp thành tối đa 1 fan-out trong cửa sổ 60s. Debounce đặt ở **main** (chống hammer trước khi đánh thức renderer); renderer thêm guard `force=false` để cache sidecar tự hấp thụ phần còn lại.
- **Fallback (hạn chế per-OS):** Electron native menu là **tĩnh** (`setContextMenu()` dựng sẵn) → lần mở menu hiện tại luôn hiển thị **snapshot gần nhất**. `tray:requestUsage` cập nhật cho lần mở **kế tiếp**. Menu phải có dòng cuối `"Cập nhật lúc HH:MM"` (từ `fetchedAt`) để user biết độ tươi. Đây là giới hạn API, không phải bug — chấp nhận theo Non-goal (stale ngắn).
  - **macOS:** left-click mở menu ngay → state về sau khi menu đã hiện; lần mở kế mới tươi. Đủ tốt cho cadence thưa.
  - **Win/Linux:** tương tự; có thể dựng menu lười hơn nhưng không đáng phức tạp hóa giai đoạn 1.

### OQ-4 — Render status trong native menu

Native `Menu` không có theme/HTML → mã hóa status bằng **text + ký hiệu unicode**, không màu:

- **Menu gốc (1 dòng/account):** label tóm tắt bucket nặng nhất, dạng:
  `"{label} · {plan} · 5h {pct}% {sym} · wk {wkPct}% · reset {countdown}"`
  ví dụ `"Max chính · max · 5h 87% ⚠ · wk 40% · reset 2h"`. `{sym}` = `⚠` (allowed_warning) / `✕` (rejected) / rỗng (allowed). Account active đánh dấu `✓` prefix. Account không khả dụng: `"{label} · usage không khả dụng"` (không %, không sym).
- **Submenu con/account:** mỗi bucket một `MenuItem` `enabled:false` (read-only) với label đầy đủ (`RATE_LIMIT_LABELS` + % + countdown) + dòng `"Cập nhật lúc HH:MM"`. Click vào account → deeplink Settings (OQ-10, PO).
- **Icon-state (warning/rejected) truyền qua icon tray**, không qua menu: dùng **biến thể nativeImage** (overlay amber/đỏ trên base; macOS giữ `setTemplateImage` cho base nhưng overlay state KHÔNG template để giữ màu). Priority gộp với task-state ở [AC-9](../features/tray-account-usage.md#ac-9--icon-priority-gộp-usage-với-tray-state-task) (`Failed > Usage Rejected > Waiting Approval > Usage Warning > Running > Idle`) — thứ tự đề xuất, PO/TL chốt chung đợt tray (OQ-2).
- **Số/màu là logic chung** (status→symbol, formatResetsIn, RATE_LIMIT_LABELS) → trích từ `SessionContextStatus.vue` ra **composable `useAccountUsage()`** (renderer, Rule of Three: popover + tray); main chỉ nhận chuỗi/symbol đã tính sẵn trong payload **hoặc** nhận status enum và tự map symbol (không cần theme). Giữ map symbol ở main là hằng nhỏ, không cần truyền chuỗi đã format để main còn i18n/định dạng giờ theo locale OS.

### OQ-8 — TTL snapshot Codex + max-token ping

- **TTL "cũ" của Codex snapshot = 5 phút (300_000 ms).** Xác nhận đề xuất BA. Lý do: cadence mở-menu thưa nên 5 phút đủ tươi; đủ lâu để một phiên chạy nhiều session/turn không kích ping lặp (turn thật đã refill snapshot qua `recordCodexUsageFromHeaders`, nên ping chỉ chạy khi account Codex **chưa** chạy turn nào trong 5 phút).
- **max-token ping = 1, fallback 16, hard-cap fallback nếu vẫn lỗi = bỏ ping (trả unavailable).** Reuse path `completePi` (no-tools, đã có `onResponse: recordCodexUsageFromHeaders` — [complete.ts:83-97](../../apps/desktop/sidecar/src/runtime/complete.ts#L83-L97)) với prompt cực ngắn (`"ping"`). **Rủi ro:** một số provider/backend từ chối `max_tokens < N` (min-token) hoặc trả lỗi với 1 token. **Fallback bậc thang:** thử 1 → nếu lỗi min-token thì thử 16 → nếu vẫn lỗi/timeout thì **không** retry tiếp, trả `{ usage: [], cachedAt }` ("không khả dụng"), **không throw** (usage là best-effort). Header rate-limit thường vẫn về kèm response **kể cả khi output token bị giới hạn**, nên 1 token đủ để nạp snapshot.
- **Staleness-guard:** chỉ ping khi `getCodexUsage` null **hoặc** `capturedAt` > TTL. Còn tươi → trả luôn, không ping (đúng [AC-8](../features/tray-account-usage.md#ac-8--codex-ping--staleness-guard--không-pollute-transcript)).
- **Không pollute transcript:** ping qua `completePi` one-shot — không tạo session/JSONL/trace, không emit event UI. Token ở nguyên sidecar. (Lưu ý: phạm vi ping account nào — mọi Codex account vs chỉ active — là **OQ-9, phụ thuộc PO**; mặc định kỹ thuật: ping mọi Codex account stale khi fan-out, staleness-guard 5 phút + 1 token giữ chi phí cực nhỏ.)

### Fan-out — tuần tự, tôn trọng cache 60s (ràng buộc rate-limit)

- Renderer (`useAccountUsage()`) gọi `accounts.list` → lọc account OAuth/subscription → gọi `account.usage` **tuần tự** (concurrency ≤ 1, hoặc ≤ 2 nếu khác provider), **không** `force: true` → tái dùng cache 60s/account của sidecar. Account `authMode !== 'oauth'` (API-key/custom): skip RPC, đánh dấu `available: false`.
- Lỗi 1 account (429/timeout) → đánh dấu account đó "không khả dụng", fan-out **tiếp tục** account còn lại (không fail toàn cục). Không retry aggressive ở renderer.
- Kết hợp với debounce trigger ≤ 1 fetch/60s ở main → xác suất 429 thấp.

## Phương án đã cân nhắc

### Channel — Option A: cặp channel riêng `tray:setState` + `tray:requestUsage` (CHỌN)
- **Pros:** biên kiểm toán riêng cho tray (như updater); shape sanitized đóng đinh được; nền tái dùng cho các đề xuất tray khác.
- **Cons:** thêm 2 channel + module `tray.ts`. Chấp nhận — nhỏ, có chủ đích.

### Channel — Option B: nhồi usage vào `engine:event` hiện có
- **Loại:** `engine:event` là forward verbatim từ sidecar (main→renderer). Tray cần renderer→main + sanitize có chủ đích trước khi main tiêu thụ → trộn vào engine event phá SoC, khó kiểm toán "không leak token", và main vẫn không nên parse event sidecar để lọc field nhạy cảm.

### Trigger — Option A: main proxy signal (`click`/`focus` + debounce) (CHỌN)
- **Pros:** dùng API ổn định (`tray.on('click')`, window `focus`); debounce ở main chống hammer; degrade về snapshot gần nhất + timestamp.
- **Cons:** lần mở menu hiện tại có thể stale (state về sau khi menu đã dựng). Chấp nhận theo Non-goal.

### Trigger — Option B: timer nền poll định kỳ
- **Loại:** trái Resolved decision #1 (no timer nền) — hammer endpoint rate-limited + ping Codex thừa.

### Codex usage — Option A: ping `completeSimple` rẻ + staleness-guard (CHỌN, theo brief)
- **Pros:** chỉ cách lấy số Codex khi chưa có turn; reuse path `completePi` đã có `onResponse`; chi phí ~0 với staleness-guard + 1 token.
- **Cons:** tiêu quota nhỏ của chính account đang đo; rủi ro min-token (có fallback bậc thang).

### Codex usage — Option B: chỉ hiển thị khi đã có turn thật (không ping)
- **Loại:** account Codex chưa chạy turn nào sẽ luôn trống → không đạt mục tiêu "xem usage tất cả account" của feature.

## Hệ quả

- **Tích cực:** tách tray-state channel rõ ràng, sanitized payload kiểm toán được (TS-14), Codex usage hiển thị được mà không pollute transcript (TS-9/10/11), không thêm timer nền, không phá cache rate-limit.
- **Tiêu cực / Trade-off:**
  - Lần mở menu hiện tại có thể stale (cần dòng "Cập nhật lúc HH:MM"); chấp nhận theo Non-goal.
  - Codex ping tiêu quota nhỏ của account đang đo; staleness-guard + 1 token giữ tối thiểu.
  - Main giữ thêm state notification dedupe ([AC-7](../features/tray-account-usage.md#ac-7--notification-throttle--không-lặp)) + icon state — phình `tray.ts` (tách khỏi `main.ts` để bù).
- **Việc cần làm tiếp (developer task — cập nhật cho PM):**
  1. **Sidecar:** mở rộng nhánh `provider === 'openai'` của [account.usage.ts](../../apps/desktop/sidecar/src/methods/account.usage.ts): staleness-guard 5 phút + ping `completePi` (max-token 1→16→bỏ, prompt `"ping"`, no-tools, no-session) → đọc lại `getCodexUsage`. KHÔNG ghi session/trace. Reuse `recordCodexUsageFromHeaders`.
  2. **Composable `useAccountUsage()` (renderer):** trích logic màu/countdown/label từ [SessionContextStatus.vue](../../apps/desktop/ui/components/session/SessionContextStatus.vue); orchestrate fan-out `accounts.list` + `account.usage` (tuần tự, không force) → build `TraySetStatePayload` sanitized.
  3. **Electron `tray.ts`** (tách `setupTray` khỏi [main.ts](../../apps/desktop/electron/src/main.ts)): dynamic submenu + tooltip + icon-state (overlay amber/đỏ, priority AC-9) + notification (`new Notification`, throttle/dedupe AC-7, gate `notificationsEnabled`) + click→focus+navigate. Render từ payload, KHÔNG gọi provider.
  4. **IPC:** `tray:setState` (invoke) + `tray:requestUsage` (send) ở [preload.ts](../../apps/desktop/electron/src/preload.ts) (`setTrayState` + `onTrayRequestUsage`) + handler/sender ở main. KHÔNG qua `engine:request`.
  5. **Trigger wiring:** `tray.on('click')` + `BrowserWindow 'focus'` → debounce ≤1 fetch/60s ở main → gửi `tray:requestUsage`.
  6. **Deeplink:** Settings → Models & Accounts nhận `?focus=account:<provider>:<accountId>` (mirror `?focus=provider:<name>`).
- **Infosec gate (trước merge):** audit `tray:setState` payload không leak token/key/UUID/request-ID (TS-14); log Codex ping chỉ header NAMES (TS-15); main không có lối gọi provider endpoint trực tiếp (invariant #1/#4).
- **Còn phụ thuộc PO (không TL tự chốt):** OQ-2 (icon priority hợp nhất đợt tray), OQ-5 (ngưỡng gộp notification N≥2/3), OQ-6 (notify khi focus?), OQ-7 (hiện email/label?), OQ-9 (ping mọi Codex account vs chỉ active), OQ-10 (deeplink Settings vs session).
- **Cập nhật tài liệu:** README index ADR (thêm 0039), CLAUDE.md bảng stack (kênh tray), spec feature (mục Technical decisions — đã append).

## Tham chiếu

- [tray-account-usage](../features/tray-account-usage.md) — feature spec (Open questions, Data shape, AC).
- [tray-account-usage.brief](../features/tray-account-usage.brief.md) — resolved decisions 2026-06-15.
- [tray-and-notifications](../design/tray-and-notifications.md) — UX tray/notification (loạt 6 đề xuất).
- [0028](./0028-auto-update.md) — pattern renderer-drive + main-reactive (channel riêng tách `engine:event`).
- [0008](./0008-stdio-ipc-for-sidecar.md) — stdio JSON-RPC sidecar (biên gọi provider duy nhất).
- [connection-quota-handling](../features/connection-quota-handling.md) — reactive counterpart (deeplink pattern).
- [.claude/rules/security.md](../../.claude/rules/security.md) — invariant #1 (token isolation) + #4 (IPC boundary).
- Code: [account.usage.ts](../../apps/desktop/sidecar/src/methods/account.usage.ts) · [openai/usage.ts](../../apps/desktop/sidecar/src/providers/openai/usage.ts) · [complete.ts](../../apps/desktop/sidecar/src/runtime/complete.ts) · [main.ts](../../apps/desktop/electron/src/main.ts) · [preload.ts](../../apps/desktop/electron/src/preload.ts) · [ipc.ts](../../apps/desktop/electron/src/ipc.ts).
