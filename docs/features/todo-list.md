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

## Data shape

`TodoItem = { content: string; status: 'pending' | 'in_progress' | 'completed' }` — khai ở [shared.ts](../../apps/desktop/sidecar/src/types/shared.ts) (sidecar) + mirror [ui/types/index.ts](../../apps/desktop/ui/types/index.ts). Gắn vào `SessionStep.todos` (khi `kind === 'note'`), `TraceNode.todos` (khi `type === 'todo'`), và **`Session.todos`** — checklist *hiện tại* của session, persist trong `SessionHeader` (line 1 của session JSONL). Step/trace là **log lịch sử**; `Session.todos` là **state hiện tại**.

## Hành vi

- **Sessions**: panel "TODOS" ghim cố định trên composer (ngoài vùng cuộn message) + section Checklist trong tab **Plan** của Workspace Panel. Cả hai đọc `Session.todos` qua [useSessionTodo](../../apps/desktop/ui-next/composables/useSessionTodo.ts) (fallback về note step mới nhất cho session chưa có field này), nên **không bao giờ lệch nhau**.
  - **Không tự ẩn khi turn kết thúc.** Panel hiện suốt khi session có checklist — đó chính là lúc user cần biết "tới đâu rồi". Mở rộng khi việc còn đang chạy (`isActive` = turn in-flight và còn item chưa xong), tự thu thành **strip một dòng `done/total`** khi không. Toggle tay vẫn sticky đến khi trạng thái activity thực sự đổi.
  - **Row sửa được.** Click một row cycle `pending → in_progress → completed → pending` rồi persist cả list (`sessions.updateTodos`). Riêng step inline trong transcript giữ **read-only**: nó là bản ghi model viết ở thời điểm đó, không phải state hiện tại.
- **Tasks**: mỗi lần gọi TodoWrite là một node `todo` trong trace (trace là log thời gian, giữ từng lần gọi).
- **Legacy**: note step cũ chỉ có `detail.text` (chưa có `todos`) không còn surface trong Sessions (panel ghim chỉ đọc `todos`); nhánh fallback text trong StepItem vẫn giữ cho các nơi khác render note step trực tiếp.

## Ngoài phạm vi

- **Không** thêm/xoá/sửa nội dung item từ UI — chỉ cycle được trạng thái. Nội dung vẫn do model viết.
- **Không** cưỡng chế model tôn trọng bản sửa của user: `<session_checklist>` là chỉ dẫn, không phải hard constraint (xem trade-off ở [ADR 0069](../decisions/0069-editable-session-checklist.md)).
- **Không** có view tổng hợp checklist cấp project (nhiều session + task). Chờ dữ liệu dùng thật rồi quyết.
- **Tasks không** persist checklist — tiến độ của task đã có DAG node status riêng, nên ở đó `TodoWrite` vẫn chỉ ACK.
