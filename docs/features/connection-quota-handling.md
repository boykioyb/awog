# Feature: Connection Quota Handling

**Trạng thái:** Ready for PM
**Owner:** Business Analyst
**Tham chiếu ADR:** [0010-pause-on-quota-for-connection-switch](../decisions/0010-pause-on-quota-for-connection-switch.md) (Accepted 2026-05-25)
**Ngày khoá Open Questions:** 2026-05-25 (xem mục [Resolved decisions](#resolved-decisions))

## Overview

Khi một node trong workflow gọi model provider và provider trả về lỗi quota/rate-limit (API key đã cạn quota tháng, vượt rate-limit, hoặc bị provider tạm khóa do billing), engine **không** đẩy task sang `failed`. Thay vào đó, task được **pause** vào trạng thái mới `waiting_connection`. Người dùng được prompt cập nhật API key của provider tương ứng trong Settings, sau đó nhấn **Resume** để engine re-run node fail từ đầu với credential mới — tận dụng pattern `waiting_approval` + node-level checkpoint đã có.

## Mục tiêu

- Người dùng không mất tiến độ artifact của các phase đã hoàn tất khi key chính cạn quota giữa chừng.
- UX cập nhật key + tiếp tục task mạch lạc, một luồng duy nhất (không phải clone task / rerun từ phase đầu).
- Giữ invariant security: API key vẫn nằm trong sidecar, không bao giờ leak qua IPC payload / UI / event log / trace.
- Phân biệt rõ "task đang đợi người duyệt artifact" (`waiting_approval`) với "task đang đợi credential mới" (`waiting_connection`).

## Non-goals (out of scope — V2)

- **Auto-rotate** giữa nhiều API key của cùng provider (multi-key pool).
- **Entity `Connection`** độc lập có priority + failover (xem ADR 0010, phương án đã cân nhắc).
- **Auto-retry với exponential backoff** dài hạn (chỉ cho phép retry thoáng qua trong adapter — xem mục Edge case).
- **Intra-node checkpoint** (lưu state ở giữa tool-call loop để Resume không mất các tool call đã chạy).
- **Auto-validate key mới** trước khi gọi Resume (engine không gọi `/models` để probe; user nhấn Resume = chấp nhận thử).

## Personas

- **Solo Builder** (persona chính của AWOG MVP) — chạy task local, biết cập nhật API key của chính mình.
- **Team Lead** (tương lai, không phải target MVP) — sẽ cần entity Connection chia sẻ; không phục vụ ở feature này.

## Happy path

```
1. User start Task T1; T1 chạy qua phase BA (completed, artifact requirement.md đã ghi).
2. T1 vào phase Architect (currentNodeId = N_arch), Run v1 status = running.
3. Sidecar gọi Anthropic API → response 429 insufficient_quota.
4. Model Adapter map response → throw ConnectionUnavailableError { provider: 'anthropic', nodeId: N_arch }.
5. Engine bắt lỗi:
   - Run v1 của phase Architect: status = failed (giữ failed cho run này — xem mục State transition).
   - Phase Architect: status = waiting_connection.
   - Task T1: status = waiting_connection, waitingConnection = { provider: 'anthropic', phaseNodeId: N_arch }.
   - Persist task.json (atomic write). Ghi event log sanitized.
6. UI receive update qua IPC event:
   - Task list: badge cam "Needs key" trên T1 card.
   - Task detail (nếu đang mở): banner ở header + modal hướng dẫn.
7. User click "Open Settings" → điều hướng tới Settings → Models & API Keys → tô sáng card Anthropic.
8. User dán key mới, nhấn Test → status dot xanh → Save.
9. User quay lại Task T1 detail, nhấn nút Resume trên banner.
10. Engine:
    - Tạo Run v2 cho phase Architect (status = running, triggeredBy = 'resume-connection').
    - Phase Architect: waiting_connection → running.
    - Task T1: waiting_connection → running. waitingConnection = null.
    - Adapter dùng key mới gọi model → succeed → artifact ghi → phase complete.
11. Workflow tiếp tục bình thường tới phase kế tiếp.
```

## Acceptance Criteria

### AC-1: Phát hiện lỗi quota / invalid key (sidecar)

- **Given** node đang gọi Anthropic SDK
  **When** SDK trả về response với `status === 429` và body chứa `type === 'error'` + `error.type === 'rate_limit_error'` hoặc `error.type === 'overloaded_error'`, hoặc trả về `insufficient_quota`
  **Then** Model Adapter throw `ConnectionUnavailableError` với fields `{ provider, kind: 'quota' | 'rate_limit', retryAfterMs? }`.
- **Given** node gọi OpenAI SDK
  **When** SDK trả `status === 429` + `error.code === 'insufficient_quota'` hoặc `'rate_limit_exceeded'`
  **Then** Model Adapter throw `ConnectionUnavailableError` tương ứng.
- **Given** node gọi provider (Anthropic / OpenAI / Google)
  **When** SDK trả `status === 401` với body chỉ rõ key invalid / revoked (Anthropic `error.type === 'authentication_error'`; OpenAI `error.code === 'invalid_api_key'`)
  **Then** Model Adapter throw `ConnectionUnavailableError` với `kind: 'invalid_key'`.
- **Given** node gọi provider
  **When** lỗi là network timeout, 5xx, schema mismatch, hoặc bất kỳ lỗi không phải `kind` ở trên
  **Then** **không** throw `ConnectionUnavailableError` — đi nhánh `failed` như cũ.

> **Naming:** vì spec đã mở rộng sang `invalid_key`, error class đổi tên từ `ConnectionUnavailableError` (tên cũ trong ADR 0010) sang `ConnectionUnavailableError` cho chính xác. ADR 0010 không cần superseded — phạm vi vẫn đúng, chỉ làm rõ contract.

### AC-2: State transition Running → WaitingConnection

- **Given** task đang `running`, một phase `running` đang chạy run v_n
  **When** node fail vì `ConnectionUnavailableError` (bất kỳ `kind`: `quota` / `rate_limit` / `invalid_key`)
  **Then**
  - Run v_n status = `failed` (giữ history rằng run này đã fail — không superseded). **Quyết định OQ-6:** dùng `failed` để giữ lịch sử lỗi, không dùng `superseded`.
  - Phase status = `waiting_connection`.
  - Task status = `waiting_connection`.
  - Task lưu `waitingConnection: { provider, phaseNodeId, failedRunVersion: n, kind, at: ISO timestamp }`.
  - **Không** chạy phase kế tiếp.
  - **Không** ảnh hưởng phase upstream đã `completed` (artifact giữ nguyên).
  - Trace của run v_n **giữ nguyên** trong UI, gắn label phụ "Aborted ({kind})" — **không** ẩn (quyết định OQ-7).

### AC-3: Resume re-run node fail từ đầu

- **Given** task ở `waiting_connection`, người dùng đã cập nhật key của đúng provider
  **When** user invoke `resumeTask(taskId)`
  **Then**
  - Tạo Run mới v_(n+1) cho phase đang waiting_connection, status = `running`, `triggeredBy = 'resume-connection'`.
  - Phase status: `waiting_connection` → `running`.
  - Task status: `waiting_connection` → `running`, `waitingConnection = null`.
  - Engine queue node để chạy lại từ đầu (mất tool-call loop trong run cũ — chấp nhận theo ADR 0010).

### AC-4: UI badge & modal

- **Given** task có status `waiting_connection`
  **When** UI render task list
  **Then** task card hiển thị **badge cam "Needs key"** (text + icon riêng), phân biệt với badge `waiting_approval` (vốn dùng màu vàng + icon khác).
- **Given** task detail mở với task ở `waiting_connection`
  **When** UI render header
  **Then** banner xuất hiện với:
  - Tiêu đề: "Connection quota exhausted — {Provider name}".
  - Mô tả: "API key cho {Provider} đã hết quota hoặc bị rate-limit. Cập nhật key mới trong Settings rồi quay lại nhấn Resume."
  - CTA chính: **Open Settings** (deeplink tới Settings → Models & API Keys, scroll & highlight card provider tương ứng).
  - CTA phụ: **Resume** (disabled cho tới khi user cập nhật + Test key thành công — xem AC-7).
- **Given** banner hiển thị
  **When** UI cần show chi tiết lỗi
  **Then** **không** hiển thị raw error message từ provider; chỉ hiển thị label do AWOG controled ("Quota exhausted" / "Rate limited").

### AC-5: Security — sanitize event log

- **Given** engine bắt `ConnectionUnavailableError`
  **When** ghi vào `events.log` của task
  **Then** event chỉ chứa: `{ type: 'phase.quota_exhausted', provider, phaseNodeId, runVersion, at }`. **Không** chứa: raw response body, request ID của provider, masked/unmasked API key, header `x-request-id`, organization ID.
- **Given** engine ghi trace
  **When** node fail vì quota
  **Then** trace node hiển thị "Provider quota exhausted" (label cố định); không expose key fragment, không expose request ID.
- **Reference:** [.claude/rules/security.md](../../.claude/rules/security.md) invariant #1 — API key không rời sidecar.

### AC-6: Restart safety

- **Given** task ở `waiting_connection`, đã persist task.json
  **When** app crash hoặc user kill process
  **Then** sau restart, engine load task.json và task vẫn ở `waiting_connection`, banner vẫn hiển thị, không tự re-run.
- **Given** app restart trong khi adapter đang giữa lúc retry trong adapter (xem AC-8)
  **When** load lại
  **Then** task được coi như `failed` của run đó, áp đúng flow AC-2 (re-detect → waiting_connection).

### AC-7: Resume guard — key chưa cập nhật

- **Given** task ở `waiting_connection`, provider Anthropic
  **When** user nhấn Resume nhưng `settings.providers.anthropic.apiKey` không thay đổi so với thời điểm task pause
  **Then** UI hiển thị inline warning "Key chưa thay đổi. Cập nhật key mới trước khi Resume.", không gọi engine.
- **Quyết định:** so sánh bằng hash (SHA-256 4 byte đầu) lưu trong `waitingConnection.keyFingerprintAtPause`. Không lưu raw key. *(Cần TL xác nhận — xem Open Question OQ-2.)*
- **Given** user đã cập nhật key
  **When** nhấn Resume mà chưa Test key
  **Then** engine vẫn chấp nhận; nếu key mới cũng fail quota → quay lại `waiting_connection` (xem AC-9).

### AC-8: Rate-limit thoáng qua — adapter retry

- **Given** provider trả 429 kèm header `retry-after: <= 5s`
  **When** Model Adapter bắt lỗi
  **Then** adapter thực hiện **tối đa 2 lần retry** (tổng wait ≤ 10s) trước khi throw `ConnectionUnavailableError`.
- **Given** retry thành công
  **When** request kế tiếp ok
  **Then** node tiếp tục bình thường, không pause task.
- **Given** vẫn fail sau retry hoặc `retry-after` > 5s hoặc kind là quota (không phải transient)
  **Then** throw `ConnectionUnavailableError` → AC-2.

### AC-9: Resume mà key mới cũng cạn quota / invalid

- **Given** task `waiting_connection`, user thay key mới, Resume
  **When** node chạy lại và lại nhận `ConnectionUnavailableError`
  **Then**
  - Task quay lại `waiting_connection`.
  - Run v_(n+1) status = `failed` (giữ history).
  - Banner cập nhật, hiển thị thêm dòng "Last attempt: {time} — {kind label}." (kind label = "still quota-exhausted" / "still rate-limited" / "key still invalid").
  - Không có giới hạn số lần Resume (user có thể thử nhiều key).

### AC-10: Native notification khi task pause (OQ-5 — chốt **có gửi**)

- **Given** task chuyển sang `waiting_connection` và app **không** focus (window không active)
  **When** engine ghi xong state vào disk
  **Then** sidecar gửi `notification.show` event lên Tauri shell với payload `{ title, body, taskId }`:
  - title: `"AWOG — Task needs key"`
  - body: `"{Task name} paused. {Provider} {kind label}. Click to fix."`
  - **không** chứa raw error / request ID / key fragment.
- **Given** user click vào notification
  **When** OS gửi click event
  **Then** Tauri shell focus window và navigate tới `/tasks/{taskId}` (deeplink reuse logic của approval notification).
- **Given** app đang focus và task pause
  **Then** **không** gửi native notification (chỉ in-app badge + banner) — tránh nhiễu.
- **Implementation note:** dùng `notificationsEnabled` flag từ settings store ([settings.ts](../../apps/desktop/ui/stores/settings.ts) đã có). Nếu `false` → bỏ qua native notification, chỉ in-app.

### AC-11: Resume all — multi-task batch resume (OQ-3 — chốt **có ở MVP**)

- **Given** ≥ 2 task đang `waiting_connection` cùng `provider`
  **When** UI render Settings → Models & API Keys → card provider tương ứng
  **Then** card hiển thị thêm dòng: "{N} task đang đợi key này. [Resume all]".
- **Given** user nhấn **Resume all** trên card provider
  **When** action invoke
  **Then**
  - UI gọi `resumeTasksForProvider(provider)` (action mới).
  - Engine loop qua tất cả task có `waitingConnection.provider === provider`, thực hiện cùng flow AC-3 cho từng task tuần tự (theo concurrency MVP "1 worker"). Mỗi task tạo Run v_(n+1) riêng.
  - Nếu một task lại fail quota → vẫn tiếp tục Resume các task còn lại; task fail quay lại `waiting_connection` (theo AC-9).
- **Given** user trên task detail của 1 task cụ thể
  **Then** nút **Resume** (AC-4) **chỉ** resume task đó, không ảnh hưởng task khác.
- **Constraint:** Resume all chỉ hiện khi N ≥ 2; với N = 1, chỉ nút Resume đơn ở task detail.

## Edge cases

| Edge case | Behavior |
|---|---|
| Provider trả 429 do rate-limit thoáng qua | Adapter retry tối đa 2 lần (≤ 10s) — xem AC-8. Chỉ pause nếu vẫn fail. |
| Resume mà chưa update key | UI guard chặn (AC-7). Nếu user bypass UI, engine vẫn cho chạy nhưng sẽ pause lại ngay (AC-9). |
| Workflow có nhiều node song song (parallel branches) | **Out of scope MVP** — MVP chỉ chạy 1 node tại một thời điểm. Note: khi support parallel sau này, mỗi branch fail có thể pause độc lập; cần spec V2. |
| Nhiều task cùng đụng quota cùng provider | Mỗi task pause độc lập, mỗi task có badge + banner riêng. **Có** Resume all trên Settings → card provider khi N ≥ 2 (AC-11). |
| 429 ở giữa tool-call loop trong node | Pause ở biên node (theo node-level checkpoint hiện tại). Tool calls đã chạy trong run đó **mất**; Run mới chạy lại tool-call loop từ đầu. Trace của run cũ vẫn lưu (đánh `failed`, label "Aborted (quota)"). |
| User update key mới nhưng cũng cạn / invalid | AC-9 — quay lại waiting_connection, banner cập nhật. |
| Provider trả 401 (invalid key / revoked) | **Đi cùng flow `waiting_connection`** với `kind: 'invalid_key'` (quyết định OQ-4). Banner copy điều chỉnh theo kind. |
| User đổi key cho **provider khác** không liên quan | Resume vẫn cho chạy; nếu provider gốc vẫn cạn → AC-9. |
| Provider không trả `retry-after` | Bỏ qua retry transient, throw `ConnectionUnavailableError` luôn. |
| Task ở `waiting_connection` quá lâu (vd. 7 ngày) | Không auto-fail. Giữ ở `waiting_connection` cho tới khi user resume hoặc xóa task. |
| User Discard task đang `waiting_connection` | Cho phép như các task khác — `superseded` hoặc xóa, theo flow Task hiện có. |

## UI specification

### Task card (task list)

- Status indicator: chấm tròn màu `theme.warning` (cam) với pulse animation chậm hơn `running`.
- Badge text: **"Needs key"** (font-size sm, font-medium), nền `theme.warningBg`, viền `theme.warningBorder`.
- Phân biệt với `waiting_approval`:
  - `waiting_approval`: màu vàng + icon `UserCheck` + text "Awaiting review".
  - `waiting_connection`: màu cam + icon `KeyRound` + text "Needs key".
- Progress bar **không** hiển thị khi `waiting_connection` (giống `waiting_approval` ẩn progress).

### Task detail header banner

- Vị trí: ngay dưới task header, trên pipeline timeline.
- Background: `theme.warningBg`, border-left 4px `theme.warning`.
- Layout (left → right):
  - Icon `KeyRound` 20px.
  - Block text: tiêu đề + mô tả (2 dòng). Copy đổi theo `kind`:
    - `quota`: "Connection quota exhausted — {Provider}. API key đã hết quota. Cập nhật key mới rồi nhấn Resume."
    - `rate_limit`: "Connection rate-limited — {Provider}. Provider rate-limit kéo dài, cần key khác hoặc đợi. Cập nhật key rồi nhấn Resume."
    - `invalid_key`: "Connection key invalid — {Provider}. Key đã bị revoke hoặc sai. Cập nhật key hợp lệ rồi nhấn Resume."
  - CTA group: `[Open Settings]` (primary outline) + `[Resume]` (primary filled, disabled state có tooltip).
- Phase card tương ứng (trong timeline) có badge nhỏ "Waiting for connection" + nền nhạt cam.
- Trace của run fail giữ nguyên trong timeline (không ẩn — quyết định OQ-7), gắn label đầu trace: "Aborted ({kind label})", text màu cam, không clickable đi đâu khác.

### Settings deeplink + Resume all

- Click "Open Settings" → `navigateTo('/settings')` với query `?focus=provider:anthropic`.
- Settings page nhận query → scroll tới card Anthropic + apply class highlight 2s pulse.
- Card provider hiển thị **counter** "{N} task waiting" khi có ≥ 1 task ở `waiting_connection` cùng provider.
- Khi N ≥ 2: thêm nút **[Resume all]** (primary, full-width dưới khu vực Test key) — invoke action `resumeTasksForProvider` (AC-11).
- Sau khi click Resume all: nút disabled trong khi engine xử lý; UI hiển thị progress "Resuming X/N…". Khi xong: toast "Resumed N tasks ({successCount} running, {pausedAgainCount} still waiting)".

### Native notification (tray)

- Trigger: AC-10. Gửi qua Tauri shell `notification` API.
- Click notification → focus app + navigate tới task detail.
- Tôn trọng `settings.notificationsEnabled` (đã tồn tại).
- Phân biệt notification của `waiting_approval` (đã có ở feature `human-approval`) bằng title prefix: `"AWOG — Task needs key"` vs `"AWOG — Task awaiting review"`.

### Không hiển thị

- Raw error body từ provider.
- Request ID provider trả về.
- Key cũ (kể cả masked dạng `sk-...abc`).
- Organization ID.

## Dependencies & impact

### Types ([apps/desktop/ui/types/index.ts](../../apps/desktop/ui/types/index.ts))

```ts
// Thêm 'waiting_connection' vào enum
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_connection'  // mới
  | 'completed'
  | 'failed'

export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'waiting_connection'  // mới
  | 'completed'
  | 'failed'

// Bổ sung field optional cho Task
export interface Task {
  // ...existing
  waitingConnection: WaitingConnectionInfo | null  // mới
}

export interface WaitingConnectionInfo {
  provider: 'anthropic' | 'openai' | 'google' | string
  phaseNodeId: string
  failedRunVersion: number
  at: string  // ISO
  keyFingerprintAtPause: string  // SHA-256 4-byte prefix (hex), không phải raw key
  kind: 'quota' | 'rate_limit' | 'invalid_key'
}

// Bổ sung 'resume-connection' vào triggeredBy của Run
export interface Run {
  // ...
  triggeredBy?: 'rerun' | 'resume-connection'  // mở rộng
}
```

### Store ([apps/desktop/ui/stores/workspace.ts](../../apps/desktop/ui/stores/workspace.ts))

- Action mới: `async resumeTask(taskId: string): Promise<void>`.
  - Validate: task tồn tại, status === `waiting_connection`.
  - Gọi sidecar IPC `task.resume` với `{ taskId }`.
  - Optimistic update: task status → `running`, phase tương ứng → `running`.
  - Rollback nếu sidecar reject.
- Action mới: `async resumeTasksForProvider(provider: string): Promise<{ resumed: number; stillWaiting: number }>`.
  - Lọc `tasks` có `waitingConnection.provider === provider`.
  - Loop tuần tự gọi `resumeTask` cho từng task; bắt lỗi từng task không làm chết loop.
  - Trả về counter cho UI hiển thị toast.
- Getter mới: `tasksWaitingConnectionByProvider: ComputedRef<Record<string, Task[]>>` — cho Settings card đếm "{N} task waiting".

### Settings store ([apps/desktop/ui/stores/settings.ts](../../apps/desktop/ui/stores/settings.ts))

- Khi user update `providers.<name>.apiKey`, store emit event hoặc bump `providerKeyVersion[provider]++` để UI banner enable Resume button.

### Sidecar contract (chưa implement, spec contract)

```ts
// Sidecar adapter layer
class ConnectionUnavailableError extends Error {
  readonly name = 'ConnectionUnavailableError'
  constructor(
    public readonly provider: string,
    public readonly kind: 'quota' | 'rate_limit' | 'invalid_key',
    public readonly retryAfterMs?: number,
  ) {
    super(`Provider ${provider} ${kind}`)  // KHÔNG embed raw response
  }
}

// Model Adapter contract
interface ModelAdapter {
  call(req: ModelRequest): Promise<ModelResponse>
  // throw ConnectionUnavailableError khi gặp 429 quota/rate-limit hoặc 401 invalid_key
  //   (sau khi đã transient retry tối đa 2 lần cho rate_limit ≤ 5s — AC-8)
  // throw Error thường cho mọi lỗi khác
}

// IPC commands mới (sidecar exposes)
type Command =
  | { type: 'task.resume'; taskId: string }
  | { type: 'task.resumeProvider'; provider: string }  // AC-11

// IPC events (sidecar → UI)
type Event =
  | { type: 'task.waiting_connection'; taskId: string; provider: string; phaseNodeId: string; kind: 'quota' | 'rate_limit' | 'invalid_key' }
  | { type: 'task.resumed'; taskId: string; phaseNodeId: string; newRunVersion: number }
  | { type: 'notification.show'; title: string; body: string; taskId: string }  // AC-10
```

### Tài liệu cập nhật

- [docs/architecture/execution-model.md](../architecture/execution-model.md) — thêm state `waiting_connection` vào lifecycle diagram (cả Task và Phase), bổ sung mô tả transition + checkpoint behavior.
- [docs/features/task-execution-engine.md](./task-execution-engine.md) — bổ sung trạng thái `waiting_connection` vào danh sách Status Task & Status Phase.
- [docs/features/settings.md](./settings.md) — note deeplink `?focus=provider:<name>` từ task detail.

## Resolved decisions

Đã được Product Owner chốt ngày **2026-05-25**. Các Open Question gốc khoá lại như sau:

| ID | Quyết định | Áp dụng ở |
|---|---|---|
| OQ-1 | **Retry tối đa 2 lần** với `retry-after` ≤ 5s trước khi pause. | AC-8 |
| OQ-2 | **Dùng SHA-256 prefix (4 byte hex)** làm `keyFingerprintAtPause`. Lưu trong task.json. Không lưu raw key. Không lo leak vì prefix 4 byte không đủ để brute-force key. | AC-7, type `WaitingConnectionInfo` |
| OQ-3 | **Resume all CÓ ở MVP** — nút "Resume all" trên Settings card provider khi N ≥ 2 task cùng đợi. | AC-11, UI section "Settings deeplink + Resume all" |
| OQ-4 | **401 invalid_key đi cùng flow `waiting_connection`** với `kind: 'invalid_key'`. Banner copy điều chỉnh theo kind. | AC-1, AC-2, edge case 401, banner copy |
| OQ-5 | **Có gửi native notification** qua Tauri shell khi app không focus, tôn trọng `settings.notificationsEnabled`. | AC-10, UI section "Native notification" |
| OQ-6 | **Run v_n đánh `failed`** (không `superseded`) để giữ lịch sử lỗi. | AC-2 |
| OQ-7 | **Không ẩn trace** của run abort, hiển thị với label "Aborted ({kind})". | AC-2, UI section banner |

## Test scenarios (input cho QA)

- **TS-1 (happy):** Anthropic key cạn giữa phase Architect → pause → cập nhật key → Resume → phase Architect hoàn tất → phase kế tiếp chạy.
- **TS-2:** Lỗi không phải quota (network timeout) → task `failed`, **không** pause.
- **TS-3:** Provider trả 429 với `retry-after: 2s`, lần retry thành công → task tiếp tục, không pause.
- **TS-4:** Provider trả 429 retry-after 30s → throw ngay, task pause.
- **TS-5:** Resume mà chưa đổi key → UI block; force resume → pause lại ngay.
- **TS-6:** Key mới cũng cạn → quay lại `waiting_connection`, banner cập nhật "Last attempt".
- **TS-7:** App crash khi đang `waiting_connection` → restart → task vẫn `waiting_connection`.
- **TS-8:** Phase upstream completed có artifact → khi Resume phase đang pause, artifact upstream **không** mất.
- **TS-9 (security):** Đọc `events.log` của task pause — không có raw API key, không có request ID provider, không có error body raw.
- **TS-10 (security):** Inspect IPC payload từ sidecar → UI — không có field nào chứa key.
- **TS-11:** Banner CTA "Open Settings" → điều hướng đúng card provider, highlight 2s.
- **TS-12:** Badge `waiting_connection` (cam, KeyRound) khác visual với `waiting_approval` (vàng, UserCheck) — accessibility: distinguishable không chỉ bằng màu.
- **TS-13:** 2 task cùng pause cùng provider → cập nhật key 1 lần → Resume từng task → cả 2 chạy được.
- **TS-14 (OQ-3):** 3 task cùng pause provider Anthropic → vào Settings → card Anthropic hiển thị "3 task waiting" + nút Resume all → click → toast "Resumed 3 tasks (2 running, 1 still waiting)" (nếu 1 task lại fail) hoặc "(3 running, 0 still waiting)".
- **TS-15 (OQ-4):** Revoke key Anthropic ở console → start task mới → SDK trả 401 invalid_api_key → task pause `waiting_connection` với kind `invalid_key`, banner copy đổi đúng theo kind.
- **TS-16 (OQ-5):** Minimize app → start task → key cạn quota → notification OS hiện với title "AWOG — Task needs key", click → app focus + navigate tới task detail.
- **TS-17 (OQ-5 negative):** `settings.notificationsEnabled = false` → task pause → **không** gửi native notification, chỉ badge + banner in-app.
- **TS-18 (OQ-5 negative):** App đang focus → task pause → **không** gửi native notification.
- **TS-19 (OQ-7):** Task pause → mở task detail → trace của run failed vẫn hiển thị trong timeline với label "Aborted (quota)".

## Đề xuất tiếp theo

- Spec đã khoá Open Questions — bàn giao cho **Project Manager** dùng skill `decompose-tasks` chia theo các surface:
  1. **Types** ([apps/desktop/ui/types/index.ts](../../apps/desktop/ui/types/index.ts)) — TaskStatus / PhaseStatus / WaitingConnectionInfo / Run.triggeredBy.
  2. **Sidecar adapter** — `ConnectionUnavailableError`, mapping 429/401 cho Anthropic + OpenAI, transient retry ≤ 5s × 2.
  3. **Engine state machine** — bắt error → pause Run/Phase/Task; action `task.resume` + `task.resumeProvider`; persist atomic; restart-load.
  4. **Event log sanitizer** — đảm bảo không leak raw error / key / request ID.
  5. **UI task list** — badge cam "Needs key" (`KeyRound`).
  6. **UI task detail** — banner theo kind, nút Resume, label "Aborted ({kind})" trên trace.
  7. **UI Settings** — counter "{N} task waiting" + nút Resume all + deeplink `?focus=provider:<name>`.
  8. **Native notification** — Tauri integration, AC-10.
  9. **Update docs** — [execution-model.md](../architecture/execution-model.md) lifecycle, [task-execution-engine.md](./task-execution-engine.md) statuses, [settings.md](./settings.md) deeplink.
  10. **Tests** — manual TS-1..TS-19; automated unit cho adapter error mapping + state transition.

## Tham chiếu

- [ADR 0010 — Pause-on-quota for connection switch](../decisions/0010-pause-on-quota-for-connection-switch.md)
- [ADR 0001 — Local-first storage](../decisions/0001-local-first-storage.md)
- [docs/architecture/execution-model.md](../architecture/execution-model.md)
- [docs/features/task-execution-engine.md](./task-execution-engine.md)
- [docs/features/human-approval.md](./human-approval.md) — pattern `waiting_approval` được nhân bản
- [docs/features/settings.md](./settings.md)
- [.claude/rules/security.md](../../.claude/rules/security.md) — invariant #1 (API key isolation)
- [apps/desktop/ui/types/index.ts](../../apps/desktop/ui/types/index.ts)
- [apps/desktop/ui/stores/workspace.ts](../../apps/desktop/ui/stores/workspace.ts)
- [apps/desktop/ui/stores/settings.ts](../../apps/desktop/ui/stores/settings.ts)
