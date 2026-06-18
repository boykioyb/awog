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

Parse dùng chung qua [runtime/todos.ts](../../apps/desktop/sidecar/src/runtime/todos.ts) (`parseTodos` + `countDone`) — input là model response (L1) nên validate phòng thủ, không throw.

## Data shape

`TodoItem = { content: string; status: 'pending' | 'in_progress' | 'completed' }` — khai ở [shared.ts](../../apps/desktop/sidecar/src/types/shared.ts) (sidecar) + mirror [ui/types/index.ts](../../apps/desktop/ui/types/index.ts). Gắn vào `SessionStep.todos` (khi `kind === 'note'`) và `TraceNode.todos` (khi `type === 'todo'`).

## Hành vi

- **Sessions**: một panel "TODOS" ghim cố định trên composer (ngoài vùng cuộn message), hiển thị checklist TodoWrite **mới nhất** của cả phiên. Vì bám note step mới nhất trên toàn bộ messages (không phải một bubble cố định), nó **luôn thấy khi cuộn message dài** và **vẫn cập nhật sau khi cancel rồi tiếp tục** (lượt mới ghi todos vào message mới, panel tự bắt). Tự ẩn khi không có todo hoặc đã hoàn thành hết.
- **Tasks**: mỗi lần gọi TodoWrite là một node `todo` trong trace (trace là log thời gian, giữ từng lần gọi).
- **Legacy**: note step cũ chỉ có `detail.text` (chưa có `todos`) không còn surface trong Sessions (panel ghim chỉ đọc `todos`); nhánh fallback text trong StepItem vẫn giữ cho các nơi khác render note step trực tiếp.

## Ngoài phạm vi

- Không có **todo store** riêng — checklist chỉ là step/trace render từ tool call (đúng comment builtin-stubs).
- Không cho user sửa todo từ UI (read-only, do model làm chủ).
