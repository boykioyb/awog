# 0055 — Liên kết 2 chiều Session ↔ Task

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-26
- **Người quyết định:** tech-lead + developer (ui-next + sidecar)

## Bối cảnh

AWOG có 3 trụ độc lập: **Session** (chat), **Task** (instance của Workflow), **Workflow** (DAG template). Trước đây chúng gần như tách rời — chỉ chung `projectId`; `tasks.discuss` chỉ là Q&A nội bộ một phase run (ghi vào `TaskRun.messages`), không phải Session thật. Việc tách là chủ ý (paradigm separation: Session là hội thoại, Task là công việc bền).

Nhu cầu mới: tạo **quan hệ 2 chiều** Session ↔ Task để (1) từ chat **spawn một Task** chạy nền (cả người dùng lẫn model), và (2) từ một Task **mở Session** bàn sâu về kết quả. Mục tiêu chính: **tận dụng hệ sinh thái đã có** (Task Execution Engine ADR 0024, sessions store, NewTaskModal, permission park), thêm tối thiểu.

Ràng buộc:

- Local-first, không database. Persist = filesystem JSONL/JSON.
- Không phá paradigm separation: link là *con trỏ*, không hợp nhất 2 domain.
- Restart-safe: link phải sống qua tắt/mở app.
- API key / secret không rời sidecar; model tự spawn task phải qua permission gate.

## Quyết định

### 1. Mô hình dữ liệu — 2 field, reuse union sẵn có

- **Task nhớ session gốc:** thêm 1 biến thể vào union `TaskSource` (KHÔNG thêm field top-level mới):
  ```ts
  | { type: 'session'; sessionId: string; messageId?: string; connectionId?: string }
  ```
  `sessionId` = session `engineId` (id canonical phía sidecar).
- **Session nhớ task đang bàn:** thêm scalar `Session.aboutTaskId?: string` (+ `SessionSummary.aboutTaskId` cho index projection).

### 2. Chiều ngược KHÔNG lưu — derive client-side

Không denormalize mảng 2 phía (tránh bug đồng bộ, đúng DRY/KISS). UI derive từ 2 Pinia store đã load:

- Session → tasks đã spawn: `tasks.filter(t => t.source.type==='session' && t.source.sessionId === engineId)`
- Task → origin session: đọc `task.source` khi `type==='session'`
- Task → discussion sessions: `sessions.filter(s => s.aboutTaskId === task.id)`

### 3. Workflow chạy — KHÔNG đổi engine

Spawn task chỉ là `createTask` + `startTask` của Task Execution Engine (ADR 0024). DAG vẫn chạy như cũ (scheduler song song cap 4, approval park, git auto-commit per node, restart-safe resume). Link không can thiệp cơ chế chạy.

### 4. Bốn entry point (UI + model, cả 2 chiều)

- **UI · Session → Task:** nút "Run as task" ở composer → mở **NewTaskModal dùng chung** (host `NewTaskModalHost` mount 1 lần ở layout, state qua `useNewTaskModal()` — mẫu `useGitModal`), pre-fill project + title, `source = { type:'session', sessionId }`. Tasks page cũng dùng host này (lift khỏi `useTasksPage`).
- **Model · Session → Task:** tool `RunWorkflow` (in-process, Pi runtime). Spawn task nền, trả ngay `{ taskId }` (không block turn). Gate: phân loại **mutating** trong `runtime/permission.ts` → mode ask/accept-edits park xin duyệt, execute tự chạy, plan mode KHÔNG đăng ký tool. **Depth-guard**: chỉ thêm ở top-level (run-stream), không vào subagent toolset → không spawn đệ quy; cap `MAX_TASKS_PER_TURN = 5`.
- **UI · Task → Session:** nút "Discuss in session" trên `TaskDetail` → `sessions.createForTask(taskId, projectId, title)` (set `aboutTaskId`) → navigate. `tasks.discuss` (Q&A inline) giữ nguyên.
- **Model · Task → Session:** **out of scope v1 (YAGNI)** — model mở session tự nói với mình không thêm giá trị.

### 5. Context injection cho discuss session

Khi `Session.aboutTaskId` set, `sessions.send-message` chèn block `<linked_task>` (status + output từng phase, **có cap**: 4k/phase, 8k tổng) vào `systemPromptAppend` **mỗi turn** — tái dùng pipeline context-assembly có sẵn (như rules/memory). Rebuild mỗi turn → context tươi nếu task còn chạy. `aboutTaskId` truyền từ UI trong send params (như `mcpServerIds`); block dựng bằng `loadTask` (`sessions/linked-task.ts`).

## Hệ quả

**Tích cực:**

- Chỉ 2 field persist; zero infra cho chiều ngược. Restart-safe tự nhiên.
- Tận dụng toàn bộ: Task engine, NewTaskModal, sessions store, permission park, context-assembly.
- Không phá paradigm separation; không database.

**Tiêu cực / rủi ro:**

- Link là con trỏ "lỏng": xóa task/session để lại con trỏ treo → UI xử lý graceful (filter rỗng, banner "đã bị xóa").
- `RunWorkflow` cho model là quyền mạnh (tốn tiền, chạy nền) → bắt buộc gate + depth-guard + cap.
- `<linked_task>` chỉ là snapshot lúc gửi turn; task chạy xong sau đó cần turn mới để model thấy kết quả mới.
- Hai overlay toast (Tasks page + host) cùng tồn tại — chấp nhận (transient, hiếm khi cùng lúc).

## Liên quan

- [ADR 0024](0024-task-execution-engine-ipc-contract.md) — Task Execution Engine (cơ chế chạy DAG).
- [ADR 0030](0030-subagent-task-tool.md) — subagent `Task` tool (khác `RunWorkflow`: delegate trong turn, không spawn task bền).
- Spec: [docs/features/session-task-link.md](../features/session-task-link.md).

## Amendment 2026-08-19 — gỡ nút "Run as task" khỏi composer

Nút ở `SessionComposer` đã được gỡ theo yêu cầu người dùng (hàng nút composer quá đông:
pin · run-as-task · enhance · attach · attach-folder · Send). Quyết định trong ADR này
**không đổi** — data model (`TaskSource` biến thể `session`, `Session.aboutTaskId`), modal
dùng chung, chiều Task → Session và tool `RunWorkflow` đều giữ nguyên. Chỉ mất đúng một
affordance do người dùng bấm ở chiều Session → Task.

Muốn trả lại thì đặt vào menu `…` ở header session (nơi các action ít dùng đã được gom),
không phải hàng nút composer.
