# Live Todo List (TodoWrite)

Hiển thị **checklist công việc trực tiếp** của agent (tool `TodoWrite`) trong UI — vừa ở Sessions (chat) vừa ở Tasks (workflow node). Liên quan [ADR 0030](../decisions/0030-subagent-task-tool.md) (Pi runtime + builtin stubs) và [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md).

## Vấn đề

`TodoWrite` được đăng ký như một **stub lịch sự** trong base toolset ([builtin-stubs.ts](../../apps/desktop/sidecar/src/runtime/tools/builtin-stubs.ts)) chỉ để tránh lỗi `Tool not found`. Hệ quả trước đây:

1. **Model gần như không gọi** — không có câu system-prompt nào nhắc agent lập/cập nhật todo (khác Claude Code vốn được prompt rất mạnh).
2. **Render kín đáo** — khi có gọi, step `note` chỉ là một dòng "Todos · N/M" phải click mới mở checklist.
3. **Tasks không wire** — `tasks/trace-mapper.ts` không xử lý TodoWrite.

## Giải pháp (3 tầng)

| Tầng | Thay đổi |
|---|---|
| **System prompt** | `TODO_USAGE_PROMPT` ([runtime/prompts.ts](../../apps/desktop/sidecar/src/runtime/prompts.ts)) được append vào systemPrompt khi tool `TodoWrite` còn trong toolset (không bị `disabledTools`/lọc qua `allowedTools`). Áp dụng cho **Sessions** ([run-stream.ts](../../apps/desktop/sidecar/src/runtime/run-stream.ts)) lẫn **Tasks** ([invoke.ts](../../apps/desktop/sidecar/src/runtime/invoke.ts)). |
| **Sessions UI** | `stepFromTodos` ([step-mapper.ts](../../apps/desktop/sidecar/src/sessions/step-mapper.ts)) tạo step `kind: 'note'` mang `todos: TodoItem[]` có cấu trúc; dùng **id ổn định `todo-list`** ([event-adapter.ts](../../apps/desktop/sidecar/src/runtime/event-adapter.ts)) → các lần gọi TodoWrite trong cùng lượt **upsert một panel tiến hóa**. Checklist **KHÔNG** render inline trong từng message — thay vào đó một **panel cấp session ghim trên composer** ([SessionTodoPanel.vue](../../apps/desktop/ui/components/session/SessionTodoPanel.vue), gắn trong [SessionChat.vue](../../apps/desktop/ui/components/session/SessionChat.vue)) derive todos từ note step `todos` **mới nhất trên toàn bộ messages**, render một checklist duy nhất (icon ✓/▸/○, completed gạch ngang + mờ), thu/mở được, tự ẩn khi rỗng hoặc đã xong hết. |
| **Tasks engine** | `traceFromToolUse`/`traceFromToolResult` ([trace-mapper.ts](../../apps/desktop/sidecar/src/tasks/trace-mapper.ts)) đặc biệt hóa TodoWrite → `TraceNode` `type: 'todo'` mang `todos`. [TraceNodeItem.vue](../../apps/desktop/ui/components/phase/TraceNodeItem.vue) render checklist trong cây trace. |
| **Shared state** ([ADR 0069](../decisions/0069-editable-session-checklist.md)) | Checklist thôi là mirror read-only của model. `Session.todos` là field authoritative duy nhất: `TodoWrite` ghi vào đó qua `ToolFilter.todoSink` (chỉ chat runtime cấp sink — Tasks giữ ACK), user ghi qua RPC `sessions.updateTodos`, và list đã persist được inject lại **mỗi turn** dưới dạng `<session_checklist>` ([todo-context.ts](../../apps/desktop/sidecar/src/sessions/todo-context.ts)) nên thao tác của user không bị lần `TodoWrite` kế tiếp ghi đè. |

Parse dùng chung qua [runtime/todos.ts](../../apps/desktop/sidecar/src/runtime/todos.ts) (`parseTodos` + `countDone`) — input là model response (L1) nên validate phòng thủ, không throw.

### Nhánh Claude SDK (dual runtime, [ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md)) — bổ sung 2026-08-15

Ở nhánh Anthropic, `TodoWrite` là **built-in của SDK** (AWOG không sở hữu implementation), nên 2 cơ chế trên không tự có. Trước bản vá này: quét 150 session anthropic ≥200KB kể từ 2026-07-20 cho **0** lần gọi `TodoWrite` — checklist tắt hoàn toàn trên nhánh SDK kể từ commit dual-runtime `b36a3d1` (02/07).

| Cơ chế | Nhánh Pi | Nhánh Claude SDK |
|---|---|---|
| Nudge `TODO_USAGE_PROMPT` | system-prompt append (rebuild mỗi turn) | **turn prompt** ([claude-sdk/run-stream.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts)) — SDK đóng băng preset append lúc tạo session và bỏ qua khi `resume`, giống lý do của response style + plan mode. Tasks ([claude-sdk/invoke.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/invoke.ts)) là one-shot nên vẫn append được |
| `<session_checklist>` | system-prompt append | **turn prompt** — cùng lý do đóng băng. Block dựng ở send-message rồi truyền xuống runner qua field riêng `sessionChecklist` (không gộp vào `systemPromptAppend`) để mỗi runtime tự chọn cách giao |
| Ghi `Session.todos` | `ToolFilter.todoSink` ở tool layer | hook `onTodos` của [claude-sdk/event-adapter.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/event-adapter.ts) — event `tool_use` là chỗ duy nhất AWOG nhìn thấy checklist. Chỉ ghi cho main agent (`parent_tool_use_id` null), khớp với việc subagent Pi không được cấp sink |

### Nhánh Claude SDK: `TodoWrite` biến mất, task tool thay thế — sửa 2026-09-07

CLI **2.1.233** gỡ nhóm tool todo/task khỏi tool surface **mặc định** trên opus 4.8 / sonnet 5 / fable 5 / mythos 5 và mới hơn. AWOG đã bật lại bằng `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` ([claude-sdk/shared.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/shared.ts) `buildSdkEnv`) — **nhưng cờ đó KHÔNG trả `TodoWrite` về.** Đo trực tiếp trên CLI 2.1.263 (`claude -p --output-format stream-json --verbose`, so `system/init.tools` có cờ vs không cờ): cờ thêm **đúng** `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate` và `TodoWrite` vẫn vắng mặt.

Hệ quả trước bản vá này: `TASK_CHECKLIST_PROMPT` tiền thân (`TODO_USAGE_PROMPT`) vẫn bảo model gọi `TodoWrite`, model tuân lệnh, CLI trả

```
Error: No such tool available: TodoWrite. TodoWrite is disabled for this session, in subagents as well as here.
```

— một round-trip mất trắng để dạy lại model điều prompt của chính AWOG nói sai. Song song đó model **vẫn** tự dùng `TaskCreate`/`TaskUpdate` (37 + 51 lần trên các session CLI 2.1.260 trong `~/.claude/projects`), nhưng adapter không hiểu chúng nên `Session.todos` không bao giờ được ghi trên nhánh SDK và panel checklist im lặng.

| Điểm | Trước | Sau |
|---|---|---|
| Nudge | `TODO_USAGE_PROMPT` (gọi tên `TodoWrite`) | `TASK_CHECKLIST_PROMPT` ([runtime/prompts.ts](../../apps/desktop/sidecar/src/runtime/prompts.ts)) — gọi tên `TaskCreate`/`TaskUpdate`/`TaskList`, **nói rõ** không có `TodoWrite` trên surface này. Nhánh Pi giữ nguyên `TODO_USAGE_PROMPT` |
| Cổng bật nudge | `isToolAllowed('TodoWrite')` | `isToolAllowed('TaskCreate')` — chính tool mà nudge yêu cầu, nên agent whitelist hẹp thì nudge tự tắt |
| Nguồn checklist | hook `TodoWrite` (whole-list) | replay CRUD từng item qua [claude-sdk/task-checklist.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/task-checklist.ts) |
| Render | mỗi `TaskCreate`/`TaskUpdate` là 1 row tool thường | gộp thành **một** row `todo-list` upsert (5 create + 12 update = 1 row) |

**Replay + seed.** `TaskCreate` cho `{task:{id,subject}}`, `TaskUpdate` cho `{taskId, status?, subject?}` (kể cả `status:'deleted'`), `TaskList` cho snapshot **authoritative** → thay cả list. Payload đọc từ **structured output** `SDKUserMessage.tool_use_result` (SDK khuyến nghị đọc field này thay vì parse text model thấy), không parse câu `"Task #1 created successfully: …"`.

Task store của CLI **sống lâu hơn một turn** còn event adapter thì dựng lại mỗi turn, nên `TaskUpdate { taskId: '3' }` ở turn 5 có thể trỏ vào item tạo ở turn 1. Vì vậy `TodoItem.taskId` được persist và truyền lại làm **seed** (`RunStreamArgs.sessionTodos` → `ClaudeAdapterHooks.sessionTodos`). Update trỏ vào id turn này chưa biết ⇒ **không apply gì và không publish**: checklist cũ giữ nguyên (stale) thay vì bị một item ghi đè cả list; call đó rơi xuống row tool thường để user vẫn thấy.

`taskId` **không** đi qua IPC của UI (`sessions.updateTodos` giữ schema `{content,status}` — id task CLI là chi tiết nội bộ sidecar). Khi user sửa checklist, RPC **tự gắn lại** id bằng cách khớp `content` với list đang có trên đĩa, nên tick/đổi thứ tự không làm mất id. Row bị user **sửa chữ** thì mất id — nudge đã dặn model reconcile qua `TaskList`/`TaskCreate` khi hai bên lệch nhau.

**Ngoài phạm vi bản vá:** task node (`claude-sdk/invoke.ts`) chỉ đổi nudge; call `Task*` ở đó vẫn render row trace thường vì checklist của task vốn là ACK-only trên cả 2 runtime.

## Data shape

`TodoItem = { content: string; status: 'pending' | 'in_progress' | 'completed'; taskId?: string }` — khai ở [shared.ts](../../apps/desktop/sidecar/src/types/shared.ts) (sidecar) + mirror [ui/types/index.ts](../../apps/desktop/ui/types/index.ts). Gắn vào `SessionStep.todos` (khi `kind === 'note'`), `TraceNode.todos` (khi `type === 'todo'`), và **`Session.todos`** — checklist *hiện tại* của session, persist trong `SessionHeader` (line 1 của session JSONL). Step/trace là **log lịch sử**; `Session.todos` là **state hiện tại**. `taskId` chỉ có trên nhánh Claude SDK (id task của CLI, dùng để resolve `TaskUpdate` của turn sau — xem mục task tool ở trên); nhánh Pi không có vì `TodoWrite` gửi cả list mỗi lần.

## Hành vi

- **Sessions**: panel "TODOS" ghim cố định trên composer (ngoài vùng cuộn message) + section Checklist trong tab **Plan** của Workspace Panel. Cả hai đọc `Session.todos` qua [useSessionTodo](../../apps/desktop/ui-next/composables/useSessionTodo.ts) (fallback về note step mới nhất cho session chưa có field này), nên **không bao giờ lệch nhau**.
  - **Không tự ẩn khi turn kết thúc.** Panel hiện suốt khi session có checklist — đó chính là lúc user cần biết "tới đâu rồi".
  - **Luôn mở ở dạng thu gọn.** Panel là **strip một dòng `done/total`**; nó **không bao giờ tự mở rộng** (kể cả khi turn đang chạy — trước đây gắn với `isActive`, đã bỏ: danh sách dài đẩy hội thoại ra khỏi màn hình mỗi lần chạy). Chỉ user mở/đóng, và trạng thái đó giữ nguyên cho tới khi đổi session. Xem full list ở tab **Plan** hoặc step inline trong transcript.
  - **Đóng được.** Nút `×` ở góc phải header (hiện khi hover) ẩn hẳn panel cho session đang xem. Checklist **mới** (`total` 0 → n) mang nó trở lại, nên đóng nhầm không bao giờ giấu mất việc chưa xem; cập nhật trên list cũ thì giữ nguyên trạng thái đã đóng.
  - **Row sửa được.** Click một row cycle `pending → in_progress → completed → pending` rồi persist cả list (`sessions.updateTodos`). Riêng step inline trong transcript giữ **read-only**: nó là bản ghi model viết ở thời điểm đó, không phải state hiện tại.
- **Tasks**: mỗi lần gọi TodoWrite là một node `todo` trong trace (trace là log thời gian, giữ từng lần gọi).
- **Legacy**: note step cũ chỉ có `detail.text` (chưa có `todos`) không còn surface trong Sessions (panel ghim chỉ đọc `todos`); nhánh fallback text trong StepItem vẫn giữ cho các nơi khác render note step trực tiếp.

## Ngoài phạm vi

- **Không** thêm/xoá/sửa nội dung item từ UI — chỉ cycle được trạng thái. Nội dung vẫn do model viết.
- **Không** cưỡng chế model tôn trọng bản sửa của user: `<session_checklist>` là chỉ dẫn, không phải hard constraint (xem trade-off ở [ADR 0069](../decisions/0069-editable-session-checklist.md)).
- **Không** có view tổng hợp checklist cấp project (nhiều session + task). Chờ dữ liệu dùng thật rồi quyết.
- **Tasks không** persist checklist — tiến độ của task đã có DAG node status riêng, nên ở đó `TodoWrite` vẫn chỉ ACK.
