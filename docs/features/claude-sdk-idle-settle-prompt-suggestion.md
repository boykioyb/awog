# Bugfix: lượt chat nhánh Claude SDK treo vô hạn khi `prompt_suggestion` tới sau `result`

| Mục | Giá trị |
|---|---|
| Loại | Bugfix |
| Ưu tiên | P0 |
| Kích thước | S |
| Runtime | Chỉ nhánh Claude SDK (`provider === 'anthropic'`) |
| Code liên quan | [run-stream.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts), [event-adapter.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/event-adapter.ts) |
| Commit gây lỗi | `745a2baa` (bật `promptSuggestions: true`) |

## 1. Vấn đề

Sau message `result`, nhánh Claude SDK không đóng stdin ngay mà chờ tín hiệu kết thúc lượt chính thức `system/session_state_changed: idle`; nếu sau `IDLE_SETTLE_MS` (4s, `run-stream.ts:138`) không có `idle` thì timer `idleTimer` tự đóng input với lý do `'result, no idle signal'` (`armIdleSettle`, `run-stream.ts:1074`).

Ở đầu vòng `for await` (`run-stream.ts:1355-1362`), MỌI message tới đều xoá `idleTimer` với giả định "message mới = CLI đã đánh thức model". Sau xoá, `idleTimer` chỉ được arm lại ở hai chỗ: khi gặp `result` (`:1378`) và khi một câu hỏi người dùng vừa được trả lời (`:786`).

Từ khi bật `promptSuggestions`, CLI phát message `prompt_suggestion` **sau** `result`. Message này không phải dấu hiệu model làm tiếp, nhưng vẫn xoá `idleTimer`. Nếu sau đó CLI không gửi `idle` (quan sát thực tế: không gửi) thì không còn gì đóng stdin, nên lượt không bao giờ finalize.

Hậu quả quan sát được: UI kẹt trạng thái pending; message thiếu `completedAt`/usage; tiến trình CLI sống mãi; session lock bị giữ (không gửi được lượt mới); cách gỡ duy nhất là Stop, và khi đó lượt bị lưu cờ `canceled` sai dù reply đã hoàn chỉnh. Ngày 2026-10-06 có 2 phiên kẹt 30–55 phút.

## 2. Luồng

### 2.1 Luồng hiện tại (lỗi)

```
assistant … → result            sawResult=true, waiting=0, !humanParked → armIdleSettle() (4s)
            → prompt_suggestion đầu vòng lặp: clearTimeout(idleTimer); adapter render chip
                                không gì arm lại idleTimer
            → (không có idle)   stdin mở mãi → for-await không kết thúc → TREO
```

### 2.2 Luồng mong muốn

```
assistant … → result            armIdleSettle() (4s)
            → prompt_suggestion chip gợi ý render; idleTimer KHÔNG bị huỷ / được giữ hạn
            → (không có idle)   ~IDLE_SETTLE_MS tính từ result → closeInput('result, no idle signal')
                                → CLI thoát → finally → lượt finalize bình thường (không canceled)
```

Các luồng phải giữ nguyên:

```
result → session_state_changed: idle                  → đóng ngay ('session idle')
result → prompt_suggestion → idle                     → đóng ngay khi gặp idle
result → assistant / stream_event (model bị đánh thức) → huỷ idleTimer, continuation chảy vào cùng lượt
result (đang có background task)                      → parked, armWaitCap, KHÔNG armIdleSettle
result (đang chờ người trả lời)                       → không đặt hạn nào
```

## 3. Acceptance Criteria

**AC-1 — Tự đóng khi không có idle.** Given lượt nhánh Claude SDK không có background task chờ và không có câu hỏi đang mở, When CLI phát chuỗi `result` → `prompt_suggestion` và sau đó không phát `session_state_changed: idle`, Then input được đóng với lý do settle trong khoảng `IDLE_SETTLE_MS` (dung sai do TL chốt, xem Q-3) tính từ lúc nhận `result`, và vòng lặp kết thúc.

**AC-2 — Có test hồi quy fail trên code hiện tại.** Given test tự động mô phỏng chuỗi message của AC-1 (CLI giả + timer giả), When chạy test trên code trước khi sửa, Then test FAIL (input không bao giờ đóng); When chạy sau khi sửa, Then test PASS.

**AC-3 — Finalize đúng, không canceled.** Given lượt ở AC-1, When input đóng do settle, Then message assistant được persist có `completedAt` và usage từ `result`, KHÔNG mang cờ canceled, session lock được nhả và người dùng gửi được lượt kế tiếp mà không phải bấm Stop.

**AC-4 — Chip gợi ý vẫn hiện.** Given `prompt_suggestion` có `suggestion` không rỗng tới trước khi input đóng và lượt chưa có `suggest_followups`, When adapter xử lý message, Then chip follow-up một lựa chọn vẫn được render như hiện tại (`event-adapter.ts:632-640`).

**AC-5 — Model thực sự làm tiếp vẫn huỷ timer.** Given đã nhận `result` và `idleTimer` đang chạy, When tới một message thể hiện model bị đánh thức (`assistant` hoặc `stream_event`), Then `idleTimer` bị huỷ, input KHÔNG bị đóng sau `IDLE_SETTLE_MS`, continuation được stream vào cùng lượt; có test.

**AC-6 — Model làm tiếp sau khi đã có `prompt_suggestion`.** Given chuỗi `result` → `prompt_suggestion`, When sau đó tới `assistant`/`stream_event`, Then timer bị huỷ như AC-5 và lượt chỉ kết thúc ở `result`/`idle` tiếp theo; có test.

**AC-7 — `idle` vẫn đóng ngay.** Given đã nhận `result`, không background task chờ, không câu hỏi mở, When tới `session_state_changed: idle` (có hoặc không có `prompt_suggestion` đứng trước), Then input đóng ngay với lý do `'session idle'`, không đợi hết `IDLE_SETTLE_MS`; có test.

**AC-8 — Background task vẫn được chờ.** Given lúc `result` tới còn ≥1 background task waitable đang chạy (parked), When `prompt_suggestion` và/hoặc `idle` tới, Then input KHÔNG đóng do settle/idle; lượt chỉ kết thúc theo đường hiện có (task cuối xong → `armGrace` 45s, hoặc wait cap); có test.

**AC-9 — Chờ người vẫn không đặt hạn.** Given lúc `result` tới đang có câu hỏi người dùng mở (`humanParked()`), When `prompt_suggestion` và/hoặc `idle` tới, Then không có timer nào đóng input chừng nào câu hỏi còn mở; có test.

**AC-10 — Trả lời câu hỏi rồi mới tới `prompt_suggestion`.** Given câu hỏi vừa được trả lời sau `result` (nhánh `finally` ở `run-stream.ts:786` đã `armIdleSettle()`), When tới `prompt_suggestion` mà không có `idle`, Then input vẫn tự đóng trong khoảng `IDLE_SETTLE_MS` (cùng lỗi với AC-1 trên đường arm thứ hai).

**AC-11 — Không đổi nhánh khác.** Given nhánh Pi hoặc Codex, Then không có thay đổi hành vi nào; `IDLE_SETTLE_MS` giữ nguyên 4s.

**AC-12 — Kiểm tay.** Given app build từ bản sửa, provider `anthropic`, `promptSuggestions` bật, When chạy 10 lượt chat liên tiếp (có ít nhất 1 lượt dùng tool), Then không lượt nào giữ trạng thái pending quá 10s sau khi reply cuối hiện ra, và không lượt nào bị lưu canceled.

## 4. Edge case

| # | Tình huống | Hành vi mong muốn | Ghi chú phân tích |
|---|---|---|---|
| E-1 | `prompt_suggestion` tới khi `idleTimer` đang chạy | Không làm mất hạn đóng (AC-1) | Đây chính là lỗi. |
| E-2 | `prompt_suggestion` tới khi đang parked trên background task | Không đóng sớm, không treo (AC-8) | `graceTimer` cũng bị xoá ở đầu vòng lặp, nhưng `armGrace()` ở cuối mỗi vòng (`:1389`) arm lại nếu `parked && waitingCount()===0 && !humanParked()` ⇒ **không cùng lỗi treo**; hệ quả duy nhất là cửa sổ grace 45s bị đếm lại từ `prompt_suggestion` (trễ thêm tối đa 45s, chấp nhận được). `waitTimer` không bị xoá ở đầu vòng lặp nên cap vẫn còn. TL xác nhận có muốn đồng bộ hành vi grace hay không (Q-4). |
| E-3 | `prompt_suggestion` tới khi đang chờ người (`humanParked`) | Không đặt hạn (AC-9) | Lúc đó không có `idleTimer` để xoá; rủi ro chỉ ở bước sau khi trả lời (E-4). |
| E-4 | Người trả lời xong → `armIdleSettle()` → rồi mới tới `prompt_suggestion` | Vẫn tự đóng (AC-10) | Cùng lớp lỗi với E-1 trên đường arm ở `:786`. |
| E-5 | `prompt_suggestion` tới sau khi input đã đóng (`closed = true`, CLI đang drain) | Không lỗi, không arm timer mới | `armIdleSettle` đã guard `closed`. Chip có thể hiện nếu message kịp tới adapter trước khi stream kết thúc — không bắt buộc. |
| E-6 | CLI gửi `idle` bình thường (trước hoặc sau `prompt_suggestion`) | Đóng ngay (AC-7) | Nếu `idle` tới trước, `prompt_suggestion` đến sau rơi vào E-5. |
| E-7 | Model thực sự bị đánh thức sau `result` (task notification, background orphan của lượt trước) | Huỷ timer, stream tiếp (AC-5, AC-6) | Đây là lý do settle tồn tại — sửa không được làm vỡ. |
| E-8 | `prompt_suggestion` có `suggestion` rỗng/không phải string | Adapter bỏ qua như hiện tại; vẫn không được làm mất hạn đóng | |
| E-9 | Lượt đã có `suggest_followups` (`sawFollowups`) | Adapter không render chip trùng; vẫn không được làm mất hạn đóng | Liên quan feature followups đang làm trên nhánh này — không đụng. |
| E-10 | Timer settle bắn khi đang có tool call in-flight | Close bị defer như hiện tại (`pendingClose`, trần `DEFER_CLOSE_MAX_MS`) | Không đổi. |
| E-11 | Nhiều `prompt_suggestion` liên tiếp, hoặc message phi-hoạt-động khác sau `result` (vd. `system` subtype khác) | Không message phi-hoạt-động nào được làm mất hạn đóng | Phạm vi phân loại "message nào là hoạt động" là Q-1. |
| E-12 | App crash / restart giữa lúc treo | Ngoài phạm vi (không sửa dữ liệu phiên cũ) | Lượt đang treo của phiên cũ không được tự chữa. |
| E-13 | User bấm Stop trong 4s settle | Canceled như hiện tại (đúng — user chủ động huỷ) | `onAbort` force close. |

Tính chất AWOG: không phụ thuộc mạng ngoài CLI; không chạm approval gate; không thêm event/trace mới (có thể thêm log `info` khi bỏ qua message phi-hoạt-động — TL quyết); không chạm git auto-commit; không thông báo mới; multi-session song song không ảnh hưởng vì timer là cục bộ mỗi lượt.

## 5. Ngoài phạm vi

- Thiết kế lại cơ chế settle sau `result`.
- Đổi giá trị `IDLE_SETTLE_MS`, `BACKGROUND_GRACE_MS`, wait cap.
- Nhánh Pi và Codex.
- Sửa dữ liệu các phiên đã lưu sai cờ canceled / thiếu `completedAt`.
- UX của chip gợi ý (vị trí, số lựa chọn, tắt/bật `promptSuggestions`).

## 6. Câu hỏi mở cho Tech Lead

- **Q-1 — Hẹp hay allowlist?** (a) Sửa hẹp: miễn riêng `prompt_suggestion` khỏi việc xoá `idleTimer`. Trade-off: diff nhỏ nhất, nhưng message phi-hoạt-động mới của CLI trong tương lai sẽ tái phát lỗi. (b) Đảo thành allowlist: chỉ message "đang hoạt động" (`assistant`, `stream_event`, `user` tool_result, có thể `system` task_* …) mới huỷ `idleTimer`. Trade-off: bền hơn, nhưng nếu sót một loại message thực sự là continuation thì sẽ cắt ngang lượt (chính lỗi mà settle được tạo ra để tránh). (c) Message phi-hoạt-động không huỷ mà **đặt lại** timer. Trade-off: đơn giản, nhưng hạn đóng bị đẩy lùi theo số message.
- **Q-2 — Trần cứng sau `result`?** Có cần một trần tuyệt đối (khi không parked, không chờ người) để mọi loại message phi-hoạt-động không thể giữ lượt mãi? Nếu có, giá trị bao nhiêu và có xung đột với continuation dài hợp lệ không?
- **Q-3 — Mốc đo của AC-1:** hạn tính từ `result` (giữ timer cũ) hay cho phép tính lại từ `prompt_suggestion` (tối đa ~2×`IDLE_SETTLE_MS`)? Cần chốt để viết test chính xác.
- **Q-4 — Grace timer (E-2):** có muốn áp dụng cùng quy tắc phân loại cho `graceTimer` (để `prompt_suggestion` không đếm lại 45s) hay giữ nguyên vì không gây treo?
- **Q-5 — Hạ tầng test:** hiện chưa có test nào cho vòng `for await` của `claude-sdk/run-stream.ts` (chỉ có test của adapter/artifact/effort…). Mô phỏng `query()` giả + fake timer trong `runStream`, hay tách logic settle thành hàm/state machine thuần để test? Lựa chọn quyết định kích thước thực tế (S có thể thành M).

## Quyết định kỹ thuật (TL)

Ngày chốt: 2026-10-06. Không cần ADR: đây là sửa lỗi trong MỘT vòng lặp của một file, khôi phục đúng ngữ nghĩa settle đã có (ADR 0058 + comment ở `IDLE_SETTLE_MS`) chứ không đổi nó; không đổi IPC, event schema, data shape, dependency, luồng approval hay persistence. Các quyết định dưới đây là nguồn tham chiếu duy nhất cho developer và QA.

### D-1 (Q-1) — Predicate có tên liệt kê message THỤ ĐỘNG đã biết; mọi message khác (kể cả loại lạ) vẫn huỷ timer

Chọn hướng "danh sách thụ động" (gần (a), nhưng có tên và có chỗ để mở rộng), bác (b) và (c).

Lý do bác (b) allowlist: khi CLI đánh thức model sau `result` (task notification, kể cả của background mồ côi từ lượt trước), message ĐẦU TIÊN tới tay AWOG là `system/task_notification` (và có thể `session_state_changed: running`), sau đó CLI mới gọi API; `stream_event` đầu tiên chỉ tới sau TTFT, mà TTFT với context dài + extended thinking hoàn toàn có thể vượt 4s. Allowlist chỉ gồm `assistant`/`stream_event` sẽ cắt continuation đúng ở khe đó; muốn vá thì phải đoán thêm các `system/*` là "tiền đề của hoạt động" — tức là quay lại trò đoán từ vựng của CLI, lần này đoán sai thì hỏng theo chiều NGUY HIỂM. SDK tự nói tập message "grows over time" và khuyên consumer bỏ qua loại lạ (`sdk.d.ts`, comment trên `SDKMessage`).

So sánh hai kiểu hỏng: danh sách thụ động bị THIẾU một loại ⇒ lượt treo — nhìn thấy được, Stop gỡ được, và log ở D-5 chỉ thẳng loại message gây ra. Allowlist bị thiếu một loại ⇒ đóng stdin giữa continuation ⇒ phantom denial ("The user doesn't want to take this action…"), model lạc hướng, mất việc — câm và hỏng dữ liệu. Chọn kiểu hỏng an toàn.

Lý do bác (c) đặt lại timer: hạn đóng trôi theo số message thụ động (mốc test không xác định), và không bảo vệ gì thêm trước loại message lạ so với D-1.

Hình dạng code (trong `run-stream.ts`, cạnh các hằng ở đầu file):

```ts
// Messages the CLI emits AFTER `result` that say nothing about the model waking up.
// They must not cancel the post-result settle/grace timers. Everything else —
// including types this list has never heard of — still counts as activity, because
// missing a wake-up cuts a continuation off, while missing a passive type only
// leaves the turn waiting (and the cancel log below names the culprit).
const PASSIVE_AFTER_RESULT = new Set<SDKMessage['type']>(['prompt_suggestion', 'rate_limit_event'])

export function isPassiveAfterResult(msg: SDKMessage): boolean {
  return PASSIVE_AFTER_RESULT.has(msg.type)
}
```

Khai `Set<SDKMessage['type']>` để tên sai/đổi tên phía SDK làm `tsc` đỏ thay vì lặng lẽ không khớp. Predicate chỉ xét `msg.type`, KHÔNG xét `subtype` — mọi `system/*` đều là hoạt động.

Danh sách chốt đúng HAI loại, đối chiếu union `SDKMessage` của `@anthropic-ai/claude-agent-sdk@0.3.280`:

| Loại | Vì sao thụ động | Bằng chứng |
|---|---|---|
| `prompt_suggestion` | Gợi ý prompt kế tiếp cho NGƯỜI, không phải việc của model | `sdk.d.ts` (`promptSuggestions`): "At most one `prompt_suggestion` per turn; arrives after the `result` message"; quan sát thực tế ở §1 |
| `rate_limit_event` | Báo cáo trạng thái hạn mức, không bao giờ là dấu hiệu đánh thức (khi model thật sự chạy lại thì `stream_event` theo ngay sau header của chính request đó, và tiền đề thật — `task_notification` — không nằm trong danh sách) | `sdk.d.ts`: "emitted when rate limit info changes"; request sinh gợi ý là một lời gọi API diễn ra SAU `result` (cùng tính năng đã gây lỗi này), nên rate-limit đổi sau `result` là hệ quả trực tiếp, không phải giả định xa |

Cố ý KHÔNG đưa vào (dù trông "thông tin"): `system/session_state_changed` (state `running` là đánh thức thật; `requires_action` có thể tới trước khi callback `canUseTool` kịp tăng `humanParks`, nên nó phải tiếp tục huỷ timer như hôm nay; `idle` thì đằng nào cũng đóng ngay), mọi `system/*` khác, `tool_progress`, `tool_use_summary`, `auth_status`, `conversation_reset`. Không có bằng chứng chúng tới sau `result`; chỉ thêm khi log D-5 cho thấy một loại nào đó huỷ settle rồi lượt treo.

Thay đổi trong vòng `for await` (thay khối `run-stream.ts:1351-1362`):

```ts
const passive = isPassiveAfterResult(msg)
const settleCancelled = !passive && idleTimer !== undefined
if (!passive) {
  // (giữ nguyên hai khối clearTimeout graceTimer / idleTimer hiện có)
}
adapter.handle(msg)
trackBackground(msg)
trackToolFlight(msg)
trackShellOutputPath(msg)
if (settleCancelled && !closed) {
  log.info('claude-sdk settle cancelled — turn continues', {
    sessionId: args.sessionId,
    type: msg.type,
    subtype: (msg as { subtype?: string }).subtype,
  })
}
// … khối `if (msg.type === 'result')`, armGrace(), flushPendingClose() giữ nguyên
```

`adapter.handle(msg)` vẫn chạy cho mọi message, nên chip gợi ý (AC-4) không đổi. `armIdleSettle()` không đổi. Đường arm thứ hai (`finally` của wrapper `askUserQuestion`, `:786`) được sửa "miễn phí": `prompt_suggestion` tới sau đó không còn huỷ timer nữa (AC-10).

### D-2 (Q-2) — KHÔNG thêm trần cứng sau `result`

YAGNI. Trần nào đủ ngắn để có ích cũng sẽ cắt continuation hợp lệ: một lượt bị đánh thức sau `result` (orphan task notification) có thể chạy chuỗi tool dài tuỳ ý, không có cận trên. Lỗ hổng còn lại là "một loại message thụ động chưa biết", và nó đã có lối thoát: log D-5 chỉ đích danh loại message, sửa bằng một dòng thêm vào `PASSIVE_AFTER_RESULT`; người dùng vẫn có Stop. Lỗ hổng này tồn tại từ trước `promptSuggestions` (mọi message đều huỷ settle) và chưa từng gây sự cố — chưa đáng để đổi lấy rủi ro cắt continuation. Spec §5 cũng đã loại "thiết kế lại cơ chế settle".

### D-3 (Q-3) — Hạn tính từ thời điểm ARM, không arm lại

Message thụ động không chạm `idleTimer`, nên hạn đóng giữ nguyên mốc lúc arm: `result` (AC-1) hoặc lúc câu hỏi được trả lời (AC-10). Dung sai cho test với fake timer là CHÍNH XÁC: chưa đóng ở `IDLE_SETTLE_MS − 1` ms sau mốc, đã đóng ở `IDLE_SETTLE_MS` ms, lý do `'result, no idle signal'`. AC-12 kiểm tay giữ ngưỡng 10s như đã viết.

### D-4 (Q-4) — Grace timer áp CÙNG luật (một guard cho cả hai timer)

Cả hai timer dựa trên cùng một tiền đề ("message mới = CLI đã đánh thức model") và nằm trong cùng một khối code; predicate D-1 là định nghĩa duy nhất của tiền đề đó. Bọc chung một `if (!passive)` đơn giản hơn tách luật, và sửa luôn hệ quả phụ ở E-2: `prompt_suggestion` không còn đếm lại cửa sổ 45s. `armGrace()` cuối vòng vẫn giữ nguyên (no-op khi `graceTimer` còn đặt). `waitTimer` không đổi. Hệ quả chấp nhận: một message thụ động KHÔNG còn kéo dài grace — đúng với định nghĩa grace ("không có continuation trong 45s sau khi task cuối xong").

### D-5 — Log khi settle bị HUỶ, không log khi bỏ qua message thụ động

Log bỏ qua message thụ động sẽ ra mỗi lượt — nhiễu, không có thông tin. Log khi `idleTimer` bị huỷ và input chưa đóng (`settleCancelled && !closed`) chỉ xảy ra khi lượt thật sự chạy tiếp sau `result` — hiếm — và mang đúng dữ liệu còn thiếu khi điều tra lỗi này: `type`/`subtype` của message đã giữ lượt mở. Điều kiện `!closed` loại trường hợp `idle` (đi qua `closeInput('session idle')` ngay trong vòng đó) để không log mỗi lượt. Mức `info`, không event/trace mới, không lên UI.

### D-6 (Q-5) — Test: tích hợp qua `runStreamClaude` với CLI giả + fake timer, cộng một test đơn vị cho predicate

Chọn (a) làm test chính vì AC-2 đòi tái hiện lỗi trên CODE CŨ — chỉ test đi qua vòng `for await` thật mới làm được; (b) một mình thì code cũ không có predicate để fail. Không tách state machine settle ra file riêng: logic settle đan vào `closeInput`/defer/`humanParks`/`liveBackground`, tách ra là refactor cỡ M không cần cho bugfix này. Đã kiểm khả thi: `attachment-blocks.test.ts` đã import `run-stream.ts` không cần mock; các lời gọi I/O lúc dựng options đều đọc `~/.awog`/`~/.claude` qua `homedir()` nên một HOME tạm rỗng là đủ, `collectWorkspaceSnapshot(undefined)` trả `undefined` không gọi git.

File: `apps/desktop/sidecar/src/runtime/claude-sdk/__tests__/run-stream-settle.test.ts`. Chạy: `cd apps/desktop/sidecar && npx vitest@2 run src/runtime/claude-sdk/__tests__/run-stream-settle.test.ts`.

Thay đổi đi kèm trong `run-stream.ts` để test không dùng số ma thuật: `export` hai hằng `IDLE_SETTLE_MS` và `BACKGROUND_GRACE_MS` (giá trị KHÔNG đổi), cùng `isPassiveAfterResult`.

Mock (đặt trước `const { runStreamClaude, isPassiveAfterResult, IDLE_SETTLE_MS, BACKGROUND_GRACE_MS } = await import('../run-stream.js')`, theo đúng lối của `artifact-task-path.test.ts`):

1. `vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({ ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()), query: (input) => fakeCli.start(input) }))` — PHẢI giữ export thật qua `importOriginal`: khoảng 12 builder `build*SdkServer` gọi `createSdkMcpServer`/`tool` thật lúc dựng options (in-process, không spawn). Mock trơn chỉ có `query` như tiền lệ sẽ làm chúng nổ.
2. `vi.mock('../../../credentials/credential-resolver.js', …)` — y hệt tiền lệ.
3. `vi.mock('../../../sessions/bg-registry.js', …)` — sáu hàm `noteExternalOutputFile`, `registerExternalBackground`, `settleExternalBackground`, `settleAllExternalBackground`, `setExternalKiller`, `clearExternalKiller` thành `vi.fn()`; module thật `emit` ra stdout của transport.
4. HOME tạm: `mkdtemp` ở `beforeAll`, gán `process.env.HOME`, khôi phục ở `afterAll` — tiền lệ `src/sources/__tests__/reserved-source-id.test.ts`. Phủ rules / ssh hosts / logtime settings / team store.
5. `vi.spyOn(log, 'info')` (`../../../util/logger.js`) để đọc lý do đóng từ dòng `'claude-sdk closing input'` (`{ reason }`) và dòng D-5.

Args tối thiểu (`as unknown as RunNonStreamArgs`): `sessionId: 'settle-test'`, `pendingText: 'hi'`, `history: []`, `settings` chép từ tiền lệ (`provider: 'anthropic'`, `modelId`, `level: 'medium'`, không đặt `mode: 'plan'`), `contextConfig: { wikiEnabled: false, memoryEnabled: false }`, `abortController: new AbortController()`, `askUserQuestion` = `vi.fn` trả một deferred do test giữ (`SessionQuestionReply` = `{ answers: [] }`). KHÔNG đặt `cwd`. `cb = { onChunk: vi.fn(), onStep: vi.fn() }`.

Harness `fakeCli` (trong file test):

- `start({ prompt, options })`: lưu `options`; chạy nền một consumer `for await (const _ of prompt) {}` — khi vòng đó kết thúc thì `inputClosed = true` và luồng output kết thúc (mô phỏng CLI thoát khi stdin đóng). Trả về một object async-iterable (output queue) có thêm `stopTask: vi.fn(async () => {})`.
- `started`: promise resolve khi `runStreamClaude` gọi `next()` lần đầu (setup xong, đã ở trong vòng lặp).
- `emit(msg)`: đẩy message vào queue và resolve khi consumer gọi `next()` LẦN KẾ TIẾP — đảm bảo thân vòng lặp cho message đó đã chạy xong. Không dựa vào số microtask tick.
- Fake timer: `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` cài SAU `await fakeCli.started` (setup chạy trên I/O thật); tiến thời gian bằng `await vi.advanceTimersByTimeAsync(ms)`.
- `afterEach`: `abortController.abort()` → `await run.catch(() => {})` → `vi.useRealTimers()`. Nhờ vậy test chạy trên code cũ FAIL ở assert chứ không treo tới timeout. Không bao giờ `await run` trước khi assert `inputClosed`.

Fixture (đều `as unknown as SDKMessage`, chỉ các field adapter đọc; thiếu field nào làm adapter ném thì bổ sung đúng field đó): `result` (`subtype: 'success'`, `result: 'done'`, `stop_reason: 'end_turn'`, `usage: { input_tokens: 10, output_tokens: 5 }`, `session_id`, `uuid`); `suggestion` (`type: 'prompt_suggestion'`, `suggestion: 'Run the tests'`, `uuid: 's1'`); `idle` (`type: 'system'`, `subtype: 'session_state_changed'`, `state: 'idle'`); `assistantText` (content một block `text`, KHÔNG có `tool_use` để không đụng defer); `streamStart` (`type: 'stream_event'`, `event: { type: 'message_start', … }`); `taskNotification(id)`; `bgChanged(tasks)`.

Câu hỏi người dùng trong test đi qua đường thật của wrapper `askUserQuestion`: gọi `options.onElicitation({ serverName: 'srv', mode: 'url', url: 'https://example.com/auth', message: 'auth' }, { signal })` từ `options` mà `fakeCli` đã lưu (không `await` lúc mở). Khi cần "người trả lời": resolve deferred, rồi `await` chính promise mà `onElicitation` trả về — nó chỉ resolve SAU `finally` của wrapper (nơi `armIdleSettle()` chạy), nên mốc thời gian của AC-10 xác định được.

Kịch bản (mốc thời gian là ms giả kể từ message/sự kiện mốc):

| # | Kịch bản | Assert | AC | Code cũ |
|---|---|---|---|---|
| S1 | `result` → +1000 `suggestion` → tiến tới +3999 → +4000 | +3999: chưa đóng; +4000: `inputClosed`, reason `'result, no idle signal'`; `await run` resolve (không ném `CANCELED`), `usage.input_tokens === 10`, `stopReason !== 'error'`; `onStep` được gọi với step id `suggest-s1` | AC-1, AC-2, AC-3 (phần runtime), AC-4 | FAIL (không bao giờ đóng) |
| S2 | Mở elicitation → `result` → trả lời (resolve deferred + `await` promise của `onElicitation`) → `suggestion` → +3999 → +4000 | Chưa đóng ở +3999 (tính từ lúc trả lời); đóng ở +4000, reason `'result, no idle signal'` | AC-10, E-4 | FAIL |
| S3 | `it.each([assistantText, streamStart, taskNotification('orphan')])`: `result` → +1000 msg → +10000 | Chưa đóng; log D-5 ghi đúng `type`/`subtype`; rồi `assistantText` + `result` → +4000 → đóng | AC-5, E-7 (task_notification là tiền đề đánh thức thật — chốt chặn chống ai đó đổi sang allowlist) | PASS |
| S4 | `result` → `suggestion` → `assistantText` → +10000 → `result` → +4000 | Chưa đóng sau +10000; đóng sau `result` thứ hai +4000 | AC-6 | PASS |
| S5 | (a) `result` → `idle`; (b) `result` → `suggestion` → `idle` | Đóng NGAY (không tiến timer), reason `'session idle'`; KHÔNG có log D-5 | AC-7, E-6 | PASS |
| S6 | `bgChanged([{ task_id: 't1', task_type: 'local_bash', ambient: false }])` → `result` → `suggestion` → `idle` → +60000 → `taskNotification('t1')` (status `completed`) → `bgChanged([])` → +20000 → `suggestion` → tới +44999 / +45000 tính từ `bgChanged([])` | Không đóng trước khi task xong; chưa đóng ở +44999; đóng ở +45000 (= `BACKGROUND_GRACE_MS`), reason `'background settled, no continuation'` | AC-8, E-2, D-4 | FAIL ở phần D-4 (code cũ đóng ở +65000) — đây là thay đổi hành vi có chủ ý |
| S7 | Mở elicitation (không trả lời) → `result` → `suggestion` → `idle` → +600000 | Không đóng | AC-9, E-3 | PASS |
| U1 | `isPassiveAfterResult` | `true`: `prompt_suggestion`, `rate_limit_event`. `false`: `assistant`, `stream_event`, `user`, `result`, `system/session_state_changed` (cả `idle` lẫn `running`), `system/task_notification`, và một type lạ `{ type: 'future_message' }` | D-1 (khoá chiều an toàn) | — (không có hàm) |

AC-3 phần persist (`completedAt`, lock nhả, không cờ canceled) nằm ở `sessions/send-message`, đường đó KHÔNG đổi: chỉ cần `runStreamClaude` resolve bình thường thay vì treo/ném `CANCELED` (S1 kiểm), phần còn lại QA kiểm qua AC-12. AC-11: review diff chỉ chạm `runtime/claude-sdk/run-stream.ts` (+ comment ở `event-adapter.ts`) và file test mới.

### Impact

- Hành vi: chỉ nhánh Claude SDK, chỉ sau `result`. Lượt kết thúc bình thường đóng ≤ 4s sau `result` khi CLI không gửi `idle`; grace 45s không còn bị `prompt_suggestion`/`rate_limit_event` đếm lại. Không đổi hằng số, IPC, event, data, UI.
- Rủi ro còn lại (chấp nhận theo D-2): một loại message thụ động MỚI của CLI trong tương lai có thể làm treo lại; nhận diện bằng log D-5 + sửa một dòng.
- Phiên đang treo trước bản sửa không tự chữa (E-12).

### Task cho developer

1. `run-stream.ts`: thêm `PASSIVE_AFTER_RESULT` + `export function isPassiveAfterResult` (D-1); `export` `IDLE_SETTLE_MS`, `BACKGROUND_GRACE_MS`; bọc khối clearTimeout đầu vòng lặp bằng `if (!passive)` + log D-5. Cập nhật các comment đang nói "any message" cho khớp luật mới: comment trên `BACKGROUND_GRACE_MS` ("Any message cancels it"), comment đầu vòng `for await`, comment trên `armIdleSettle`, comment trong `finally` của wrapper `askUserQuestion` ("Bất kỳ message nào tới cũng huỷ nó"), và comment `prompt_suggestion` ở `event-adapter.ts:628-631` (nó nói vòng lặp "đợi idle" — thêm rằng message này không huỷ hạn settle).
2. Viết `__tests__/run-stream-settle.test.ts` theo D-6; xác nhận S1, S2 FAIL khi tạm gỡ phần sửa (bằng chứng AC-2), rồi PASS sau khi sửa.
3. `pnpm typecheck` + `pnpm lint` của sidecar; chạy cả thư mục `src/runtime/claude-sdk/__tests__/`.
4. QA: AC-12 kiểm tay (10 lượt, ≥1 lượt có tool, `promptSuggestions` bật).
