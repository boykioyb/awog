# Feature — Liên kết 2 chiều Session ↔ Task

> ADR: [0055](../decisions/0055-session-task-link.md). Engine chạy: [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md).

## Mục tiêu

Nối Session (chat) và Task (instance Workflow) theo 2 chiều, tận dụng hạ tầng sẵn có:

- Từ chat **spawn một Task** chạy nền — người dùng bấm nút **hoặc** model tự gọi tool.
- Từ một Task **mở Session** để bàn sâu về kết quả (agent có context của task).
- Điều hướng + hiển thị liên kết ở cả hai phía.

**Không** phải workflow mới: Session bàn giao việc cho Task Execution Engine; phần chạy DAG giữ nguyên.

## Mô hình dữ liệu

- `TaskSource` thêm biến thể `{ type:'session'; sessionId; messageId?; connectionId? }` — `sessionId` = session `engineId`.
- `Session.aboutTaskId?: string` (+ `SessionSummary.aboutTaskId`) — task mà session này bàn.
- Chiều ngược (session→tasks, task→sessions) **derive client-side**, không lưu.

## Entry point

### A. Session → Task (UI: "Run as task")

`SessionComposer` có nút "Run as task" → `SessionDetail` mở `NewTaskModal` dùng chung (`useNewTaskModal().openModal`) pre-fill project = session.project, title = session.title, `originSessionId = engineId`. Modal ẩn source picker (source = session). Tạo qua `tasks.create` → task hiện ở tab **Tasks** của session (`WorkspaceTasks`) + Tasks page (badge "Từ session").

### B. Session → Task (model: tool `RunWorkflow`)

Model gọi `RunWorkflow({ workflowId, title?, prompt? })` → spawn task nền, trả ngay `{ taskId }`. Gate quyền (permission.ts, mutating): ask/accept-edits xin duyệt, execute tự chạy, plan mode ẩn tool. Không có ở subagent (depth=1); cap 5 task/turn.

### C. Task → Session (UI: "Discuss in session")

`TaskDetail` có nút "Discuss in session" → tạo session `aboutTaskId = task.id` → navigate. Mỗi turn, sidecar chèn `<linked_task>` (status + output từng phase, có cap) vào system prompt. `TaskDetail` liệt kê ngược các discussion session.

### D. Task → Session (model)

Out of scope v1 (YAGNI).

## Acceptance Criteria

- **AC1 (A):** Given session S trong project P, When bấm "Run as task" → chọn workflow → tạo, Then task xuất hiện ở `WorkspaceTasks` của S với status live; mở Task detail thấy badge "Từ session"; click badge → quay lại S.
- **AC2 (B):** Given session S mode=ask, When model gọi `RunWorkflow`, Then hiện permission prompt; Approve → task `queued` rồi chạy; Deny → tool trả lỗi mềm, turn tiếp tục. Mode=execute → chạy không hỏi. Mode=plan → tool không tồn tại.
- **AC3 (C):** Given task T xong, When bấm "Discuss in session", Then session mới có banner "Đang bàn về task: <title>"; hỏi về kết quả → agent trả lời dựa `<linked_task>`; `TaskDetail` của T liệt kê session đó ở "Discussions".
- **AC4 (điều hướng):** Banner session → click mở task; row task ở `WorkspaceTasks` → click mở task; "Discussions" → click mở session. Đều hoạt động kể cả khi điều hướng chéo trang (store tự hydrate).
- **AC5 (restart-safe):** Tắt/mở app → session vẫn thấy banner + danh sách task; task vẫn thấy origin + discussions.

## Edge cases

- Xóa task mà session `aboutTaskId` trỏ tới → banner hiển thị id (filter discussions rỗng), không crash; `<linked_task>` bỏ qua (loadTask null).
- Xóa session mà task `source` trỏ tới → task giữ source; click badge → `openByEngineId` trả false (không điều hướng).
- Session chưa có `engineId` (mock/browser-dev) → "Run as task" mở modal như tạo task thường (không stamp session); `WorkspaceTasks` rỗng.
- `RunWorkflow` khi session không có project → tool không được đăng ký (cần project để tạo task).
- Task chưa có run nào → `<linked_task>` chỉ chèn title/status.
- Workflow rỗng trong workspace → mô tả tool báo "không có workflow để chạy".

## File chạm

**Sidecar:** `types/shared.ts`, `methods/tasks.create.ts`, `methods/sessions.upsert.ts`, `methods/sessions.send-message.ts`, `sessions/store.ts`, `sessions/linked-task.ts` (mới), `runtime/tools/run-workflow-tool.ts` (mới), `runtime/run-stream.ts`, `runtime/permission.ts`.

**ui-next:** `stores/tasks.ts`, `stores/sessions.ts`, `composables/useSessionsMock.ts`, `composables/useSessionTaskLink.ts` (mới), `composables/useNewTaskModal.ts` (mới), `composables/useTasksPage.ts`, `components/task/NewTaskModalHost.vue` (mới), `components/task/NewTaskModal.vue`, `components/task/TaskDetail.vue`, `components/task/TaskSourceBadge.vue`, `components/session/SessionDetail.vue`, `components/session/SessionComposer.vue`, `components/session/workspace/WorkspaceTasks.vue`, `pages/tasks.vue`, `layouts/default.vue`, i18n `tasks`/`sessions`/`sessions-composer`/`sessions-workspace`.
