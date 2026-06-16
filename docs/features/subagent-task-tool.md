# Subagent `Task` tool

> Cho phép model delegate một việc tập trung sang một AWOG agent chuyên trách, chạy như subagent lồng và trả kết quả. Khử luôn lỗi `Tool Task not found`. Quyết định: [ADR 0030](../decisions/0030-subagent-task-tool.md).

## Vấn đề

Sau migration sang Pi SDK ([ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md)), runtime không còn tool `Task`. Khi chạy bằng credential **OAuth** (Claude.ai / Claude Code subscription), model bị điều kiện như Claude Code nên tự gọi `Task`; Pi `agent-loop` trả `createErrorToolResult("Tool Task not found")`. Đồng thời AWOG mất khả năng delegate đúng tầm nhìn "guild of agents", dù UI (subagent drawer + step nesting) đã sẵn sàng từ thời SDK cũ.

## Hành vi

### Lời gọi

Tool `Task` nhận:

| Param | Ý nghĩa |
|---|---|
| `description` | Nhãn ngắn (3-5 từ) để hiển thị |
| `prompt` | Toàn bộ việc giao cho subagent (self-contained — subagent chạy autonomous, không hỏi lại) |
| `subagent_type` | **Tùy chọn.** Tên agent muốn gọi (model chọn từ menu trong `description`). **Bỏ trống** → chạy subagent **general-purpose** kế thừa cấu hình của turn cha |

`description` của tool **liệt kê** các agent trong scope (tên + mô tả 1 dòng) để model chọn đúng `subagent_type`.

`subagent_type` cố ý để `Type.Optional`: dưới OAuth model bị điều kiện hoá như Claude Code (luôn có `general-purpose` default) nên thỉnh thoảng bỏ field. Đánh `required` khiến Pi validator hard-fail trước `execute()` (lỗi khó hiểu). Thay vì bounce, AWOG mượn ngữ nghĩa craft `spawn_session` ("omitted fields **inherit from the spawning session**"): bỏ trống → subagent general-purpose kế thừa parent. Chỉ khi model **nêu tên cụ thể nhưng sai** mới trả lại danh sách để sửa typo.

### Resolve subagent

0. **Bỏ trống `subagent_type`** → `agent = null`: dựng context general-purpose kế thừa `parentSystemPrompt` + `parentAllowedTools` + `parentSettings` (provider/model/account) + `parentMcpServers` của turn cha. Bỏ qua bước 1-2.
1. Match `subagent_type` → AWOG Agent: ưu tiên `id`, rồi `name` (case-insensitive), rồi slug của name.
2. `resolveAgentContext` (tái dùng từ Tasks) → `systemPrompt` + `allowedTools` + `mcpServers` (secret expand) + `provider/model/accountId`.
3. **Settings subagent** = honor frontmatter AGENT.md khi có (`provider/model/accountId`), fallback về settings của turn cha. `level` + `mode` luôn kế thừa cha.
4. `resolveCredential` + `resolveModel` cho subagent → mỗi subagent chạy được provider/account riêng. Credential **không rời sidecar**.

### Chạy subagent

- Toolset subagent build qua `createRuntimeToolDefinitions` (built-in + MCP), filter theo `allowedTools` + session denylist. **Không** kèm `Task` và **không** `ExitPlanMode` → **depth = 1**, subagent không spawn subagent (giống Claude Code).
- **MCP của subagent = MCP của turn cha (đã resolve: whitelist ∩ enabled + secret expand) ∪ MCP riêng của AGENT.md** (`TaskToolDeps.parentMcpServers`, `mergeMcpServers`). Bảo đảm subagent luôn với tới được **mọi server mà parent với tới** — "session dùng được MCP nào thì subagent nó spawn cũng dùng được". Trước đây subagent chỉ build từ `agent.mcpServerIds` riêng nên một subagent có whitelist hẹp hơn sẽ **mất** server của session (vd gọi `mcp__<id>__*` báo "not found").
- `runAgentLoop` lồng bên trong `execute()` của tool, `toolExecution: 'sequential'`.
- Event subagent forward về callback của parent với `parentId = toolCallId` của lời gọi `Task`. Text subagent **không** đổ vào reply chính của parent — chỉ trả về model làm kết quả tool.

### Permission

| Ngữ cảnh | Gate subagent |
|---|---|
| Session `ask` / `accept-edits` | Reuse gate của parent → Write/Bash của subagent vẫn prompt user |
| Session `execute` | Không gate |
| Session `plan` | **Không** đăng ký `Task` (plan = read-only) |
| Task (workflow node) | Bypass (always-allow), nhất quán [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md) D-7 |

### Graceful fallback (khử lỗi gốc)

`Task` luôn được đăng ký ở top-level (chat non-plan + task), tôn trọng `allowedTools/disabledTools`. Khi:

- **Bỏ trống `subagent_type`** (kể cả **0 agent** trong workspace) → chạy subagent general-purpose kế thừa parent (không còn lỗi "No subagent_type was provided").
- **`subagent_type` sai** (nêu tên không khớp agent nào) → trả content liệt kê type hợp lệ + gợi ý bỏ trống để chạy general-purpose, cho model sửa.
- **Vượt cap** (`MAX_SUBAGENTS_PER_TURN = 25` / turn) → trả content yêu cầu tự làm phần còn lại.
- **Subagent lỗi** → trả content báo lỗi (non-fatal) để parent re-plan, không abort cả turn.

→ Không bao giờ còn `Tool Task not found`, kể cả khi chưa có agent nào.

## Stub các built-in tool khác

Cùng họ lỗi với `Task`: dưới OAuth model còn gọi `TodoWrite`/`WebSearch`/`WebFetch`. Đăng ký stub graceful ([builtin-stubs.ts](../../apps/desktop/sidecar/src/runtime/tools/builtin-stubs.ts)) trong **base toolset** (`createAwogToolDefinitions` → có ở chat + task + subagent, filter theo allowedTools/disabledTools):

| Tool | Hành vi |
|---|---|
| `TodoWrite` | ACK + render checklist thành step `note` (`Todos · done/total`, click xem chi tiết ○/▸/✓). AWOG không có todo store riêng. |
| `WebSearch` | Trả "không khả dụng" — chưa wire search backend / API key. |
| `WebFetch` | **Tool thật** từ [ADR 0042](../decisions/0042-webfetch-tool-ssrf-guarded.md) ([web-fetch-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/web-fetch-tool.ts)): fetch URL http/https công khai → text (HTML→text). SSRF guard: protocol + hostname literal (`ssrfCheck`) + DNS resolve re-check + redirect re-check mỗi hop + timeout/size cap. Giữ invariant #7 vì chặn private/loopback/link-local. |

→ Hết "Tool ... not found" cho cả nhóm.

Bộ built-in còn được mở rộng (in-process, gate write tools): **`MultiEdit`**, **`NotebookEdit`/`NotebookRead`**, và **`browser_tool`** (Chromium nhúng — [ADR 0043](../decisions/0043-browser-tool-embedded-chromium.md)). `WebSearch` vẫn stub.

## Phạm vi

Bật ở **cả Sessions (chat) lẫn Tasks (workflow node)**.

## UI

Không đổi — hạ tầng đã có sẵn:

- `SessionStep.parentId` + `children` ([types/index.ts](../../apps/desktop/ui/types/index.ts)).
- [stores/sessions.ts](../../apps/desktop/ui/stores/sessions.ts) `upsertStep`: step có `parentId` → nest dưới `children` của step `Task` (fallback top-level nếu parent chưa tới).
- [SessionSubagentDrawer.vue](../../apps/desktop/ui/components/session/SessionSubagentDrawer.vue): click step `task` → drawer hiện `step.children`.
- Tasks: trace node con nest dưới node `Task` qua `parentId` ([node-runner.ts](../../apps/desktop/sidecar/src/tasks/node-runner.ts)).

## File chạm

| File | Thay đổi |
|---|---|
| [runtime/tools/task-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/task-tool.ts) | **Mới** — `createTaskTool` + `spawnSubagent` |
| [runtime/tools/builtin-stubs.ts](../../apps/desktop/sidecar/src/runtime/tools/builtin-stubs.ts) | **Mới** — stub `TodoWrite`/`WebSearch` (WebFetch tách ra tool thật, [ADR 0042](../decisions/0042-webfetch-tool-ssrf-guarded.md)) |
| [runtime/tools/web-fetch-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/web-fetch-tool.ts) | **Mới** ([ADR 0042](../decisions/0042-webfetch-tool-ssrf-guarded.md)) — `createWebFetchTool` thật, SSRF-guarded |
| [runtime/tools/index.ts](../../apps/desktop/sidecar/src/runtime/tools/index.ts) | Export `isToolAllowed`; thêm stub + WebFetch vào base toolset |
| [sessions/step-mapper.ts](../../apps/desktop/sidecar/src/sessions/step-mapper.ts) | Thêm `stepFromTodos` (TodoWrite → step `note`) |
| [runtime/event-adapter.ts](../../apps/desktop/sidecar/src/runtime/event-adapter.ts) | Thêm `parentId` option (stamp step + nén onChunk khi child); special-case TodoWrite |
| [runtime/invoke.ts](../../apps/desktop/sidecar/src/runtime/invoke.ts) | `createInvokeAdapter(cb, parentId)` + wire Task tool |
| [runtime/run-stream.ts](../../apps/desktop/sidecar/src/runtime/run-stream.ts) | Wire Task tool (non-plan), thread `projectId` |
| [sessions/runner.ts](../../apps/desktop/sidecar/src/sessions/runner.ts) | `RunNonStreamArgs.projectId` |
| [methods/sessions.send-message.ts](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts) | Truyền `projectId` |
| [sdk/invoke.ts](../../apps/desktop/sidecar/src/sdk/invoke.ts) | `InvokeArgs.projectIds` + `connectionId` |
| [tasks/node-runner.ts](../../apps/desktop/sidecar/src/tasks/node-runner.ts) | Truyền `projectIds` + `connectionId` |

## Bảo mật (8 invariant)

- **API key không rời sidecar:** subagent resolve credential trong sidecar; key không vào step/trace/IPC payload.
- **Path/Git scope:** subagent fs/bash dùng cùng `cwd = workspaceRoot` + `assertInsideWorkspace`.
- **Budget:** depth = 1 + sequential + cap 25 spawn/turn.
- **IPC boundary / no eval / no SSRF:** không phát sinh surface mới (tái dùng tool + MCP hiện có).

## Việc còn lại

- Cập nhật chú thích `<mcp-preference>` (subagent **nay có** MCP riêng theo AGENT.md).
- (Tùy chọn) surface text tổng kết của subagent thành 1 step `note` nested.
- infosec review path spawn lồng + credential per-subagent.
