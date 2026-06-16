# Session — Steering (chèn) + Queue (hàng đợi)

Cho phép người dùng **gõ tiếp trong khi một turn đang stream** và chọn một trong hai
hành vi:

- **Insert / Chèn (mặc định)** — _steering_: chèn nội dung vào **chính turn đang chạy**.
  Model tiếp nhận ở ranh giới bước kế tiếp và điều chỉnh hướng đi.
- **Queue / Hàng đợi** — đẩy message vào hàng đợi; tự gửi thành **turn mới** (FIFO)
  ngay khi turn hiện tại kết thúc.

> Phạm vi: **Sessions** (chat tương tác). Tasks/subagent không dùng (headless, không
> có người ngồi gõ giữa chừng).

## Trải nghiệm

Khi **không** stream: ô chat hoạt động như cũ (một nút Send).

Khi **đang** stream, khu nút bên phải ô input có: nút **Stop** + một **nút Send dạng
split** (nút chính + caret mở dropdown):

| Hành động | Khi nào | Kết quả |
|---|---|---|
| Nút chính (Insert) | Draft chỉ có text | Steer text vào turn đang chạy |
| Nút chính (Queue) | Draft kèm attachment/quote | Đưa cả cụm vào hàng đợi (steer chỉ nhận text) |
| Dropdown → Chèn vào phản hồi | text-only | Steer |
| Dropdown → Thêm vào hàng đợi | luôn | Queue |
| Enter (send chord) | đang stream | = nút chính |

Danh sách hàng đợi hiển thị **ngay trên ô input** (component `SessionQueueList`), đánh số
theo thứ tự gửi, có nút bỏ từng item + "Xoá hàng đợi".

Một steer khi được model tiếp nhận sẽ hiện **inline trong timeline của agent** như một
user-note (`kind: 'steer'`), luôn hiển thị (không bị gập vào cụm tool).

## Steering ăn ở đâu (lưu ý quan trọng)

Pi SDK chỉ poll steer **tại ranh giới turn** (sau khi các tool call của turn hiện tại
chạy xong, trước lần gọi LLM kế tiếp — `AgentLoopConfig.getSteeringMessages`). Hệ quả:

- Phiên **nhiều tool** (coding) → steer ăn gần như tức thì ở bước kế.
- Reply **text thuần** không có tool → steer chỉ được thấy ở cuối turn (xấp xỉ queue).

Đây là giới hạn của runtime, không phải lựa chọn của AWOG.

## Kiến trúc

Không cần đổi sang `AgentHarness`. `runAgentLoop` cấp thấp (AWOG đang dùng từ
[ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md)) đã hỗ trợ sẵn hook
steering trong config.

### Sidecar

- [`sessions/steering.ts`](../../apps/desktop/sidecar/src/sessions/steering.ts) — registry
  in-memory keyed theo `messageId` (cùng khoá với aborter registry). `beginSteerTurn` /
  `endSteerTurn` mở/đóng kênh; `enqueueSteer` đẩy (trả `null` nếu turn không còn sống);
  `drainSteer` lấy + xoá.
- RPC [`sessions.steer`](../../apps/desktop/sidecar/src/methods/sessions.steer.ts) —
  `{ sessionId, messageId, text }`. Best-effort như `sessions.cancel`: `{ ok: false }` nếu
  turn đã kết thúc (UI fallback gửi thành turn thường).
- [`sessions.send-message`](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts)
  — `beginSteerTurn` ở đầu, `endSteerTurn` ở `finally`, truyền
  `getSteeringMessages: () => drainSteer(messageId)` vào runner.
- [`run-stream.ts`](../../apps/desktop/sidecar/src/runtime/run-stream.ts) — wire
  `getSteeringMessages` vào `runAgentLoop`: drain → phát một step `kind:'steer'` qua
  `cb.onStep` (được `send-message` stamp `textOffset` + persist vào `parts`) → trả về các
  message `{ role:'user' }` để loop inject.

**Trade-off resume:** steer chỉ persist dưới dạng inline part trong message của agent,
**không** thành một user-message riêng trong JSONL. Khi rebuild context cho turn sau
([context-builder.ts](../../apps/desktop/sidecar/src/runtime/context-builder.ts) chỉ đọc
`text` + role, đã sẵn **không** persist tool blocks), instruction steer không vào lại
context — nhưng phản hồi của agent trong turn đó đã phản ánh nó, nên nhất quán với
trade-off resume hiện có.

### UI

- `types`: thêm `kind:'steer'` + `steerText` vào `SessionStep`; thêm `SessionQueuedMessage`.
- [`stores/sessions.ts`](../../apps/desktop/ui/stores/sessions.ts):
  - `sendSteer(sessionId, text)` — gọi RPC `sessions.steer` với `messageId` active; fallback
    `sendMessage` nếu turn đã xong.
  - State `queues` + `enqueueMessage` / `removeQueued` / `clearQueue` / `flushQueueHead` +
    getter `queuedMessages`. **Ephemeral** — không persist, reload mất hàng đợi.
  - `sendMessage` thành công → `onRevealDone` gọi `flushQueueHead` (sau `doFinalize`, lúc
    history đã authoritative + cờ streaming đã gỡ). Cancel/error **không** flush (giữ nguyên
    hàng đợi cho user quyết định).
- [`SessionComposer.vue`](../../apps/desktop/ui/components/session/SessionComposer.vue):
  split send button + routing send-chord khi streaming; `composeSendArgs()` dùng chung
  cho Send/Queue (slash command expand một lần).
- [`SessionQueueList.vue`](../../apps/desktop/ui/components/session/SessionQueueList.vue):
  danh sách hàng đợi trên ô input.
- [`SessionMessageItem.vue`](../../apps/desktop/ui/components/session/SessionMessageItem.vue):
  render block `steer` inline (always-visible, như question card).

## Trạng thái "đang chờ người" (park) — phụ trợ

Khi turn gọi **AskUserQuestion** hoặc gặp **permission prompt**, nó **park** chờ người
— không stream nhưng vẫn "in-flight". Ba chỗ phản ánh điều này:

1. **Byline mỗi message** ([SessionMessageItem.vue](../../apps/desktop/ui/components/session/SessionMessageItem.vue)):
   thay vì `Streaming… {elapsed}` (timer chạy theo wall-clock), hiện `Clock` +
   "Đang chờ bạn trả lời" / "Đang chờ bạn cấp quyền" — **không đếm giờ**. Phát hiện qua
   step `kind:'question'` chưa có `answers`, hoặc `pendingPermission` trỏ message này.
2. **Chấm tab Sessions** ([HeaderTabBar.vue](../../apps/desktop/ui/components/HeaderTabBar.vue)):
   getter `anyAwaitingInput` → chấm **warning (amber)** + title "Đang chờ bạn phản hồi",
   khác chấm **accent** (đang stream).
3. **Notification khi không focus**: permission đã có sẵn; AskUserQuestion bắn qua
   `notify()` (tự suppress khi cửa sổ focus) trong branch `session.step` của store.

### Elapsed trừ thời gian chờ (waitingMs)

Một turn chờ người 8 phút không nên hiện "8m". Trường `waitingMs` trên `SessionMessage`
cộng dồn tổng thời gian park, và elapsed hiển thị = `wall-clock − waitingMs` (guard ≥ 0):

- **Sidecar** đo quanh `await pending` trong `canUseTool` + `askUserQuestion`
  ([send-message](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts)),
  persist `waitingMs` lên agent message → reload vẫn đúng.
- **UI store** track **live** (`enterPark`/`exitPark` keyed theo messageId) để ticker
  "Streaming…" vừa resume sau khi trả lời cũng trừ phần đã chờ. Enter ở
  permission-request/question-step; exit ở `resolvePermission`/`answerQuestion` + ở
  `finally` của turn (cancel/error khi đang park).

## Biên & quyết định

- **Steer = text-only.** Attachment/quote cần một turn đầy đủ → tự định tuyến sang Queue.
- **Queue auto-send FIFO**, mỗi item là một turn riêng (user bubble + agent bubble). Đệ quy
  qua `flushQueueHead` để rút cạn hàng đợi.
- **Không persist hàng đợi** (giống `pendingAttachments`). Reload = mất.
- i18n: keys `session.composer.steer*` / `session.composer.queue*` / `session.queue.*` /
  `session.steer.label` (en + vi).
