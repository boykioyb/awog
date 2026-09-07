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
| `subagent_type` | **Tùy chọn.** Tên agent muốn gọi (model chọn từ menu trong `description`). **Bỏ trống** → chạy subagent **general-purpose** kế thừa cấu hình của turn cha. `"fork"` → general-purpose **+ đuôi transcript của phiên cha** ([ADR 0083](../decisions/0083-pi-subagent-parity.md) §d) |
| `model` | **Tùy chọn.** TIER model cho lần gọi này: `opus \| sonnet \| haiku \| fable \| inherit`. Thắng model trong AGENT.md. Bỏ qua với `fork`. **Không** nhận model id tự do ([ADR 0083](../decisions/0083-pi-subagent-parity.md) §a) |
| `run_in_background` | **Tùy chọn, chat only.** `true` → trả về ngay một `task_id`, subagent chạy nền trong lượt; thu kết quả bằng `TaskOutput` ([ADR 0083](../decisions/0083-pi-subagent-parity.md) §b) |
| `name` | **Tùy chọn.** Tên gọi để địa chỉ hoá subagent trong `TaskOutput` / `TaskStop` / `SendMessage` |

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

## Ngang bằng với nhánh Claude SDK ([ADR 0083](../decisions/0083-pi-subagent-parity.md))

AWOG chọn runtime **theo provider** ([ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md)). `AgentInput` của Claude Agent SDK có 5 khả năng mà nhánh Pi thiếu; bản này bù 4:

| Khả năng | Nhánh Pi hiện tại |
|---|---|
| a. Model tại call site | ✅ `model` = TIER đóng, resolve theo account ([model-tier.ts](../../apps/desktop/sidecar/src/runtime/subagents/model-tier.ts)) |
| b. Chạy nền | ✅ `run_in_background` + `TaskOutput` / `TaskStop` — **chat only, sống đúng bằng lượt cha** |
| c. Worktree cô lập | ✅ `isolation: "worktree"` — **chat only, chỉ cô lập, KHÔNG tự merge** (xem mục dưới) |
| d. Fork context | ✅ `subagent_type: "fork"` + trần 60k ký tự ([fork-history.ts](../../apps/desktop/sidecar/src/runtime/subagents/fork-history.ts)) |
| e. Nhắn tiếp | ✅ `SendMessage({ to, message })` — nối vào **đúng context cũ**, chỉ khi subagent đã xong lượt |

### Ba tool đi kèm (chat only)

| Tool | Tham số | Hành vi |
|---|---|---|
| `TaskOutput` | `task_id`, `block?` (mặc định true), `timeout?` (mặc định 120s, tối đa 600s) | Thu kết quả subagent nền. Hết giờ mà chưa xong → trả trạng thái `running`, **không** huỷ subagent |
| `TaskStop` | `task_id` | Dừng một subagent nền. Dừng cái đã xong là vô hại |
| `SendMessage` | `to`, `message` | Chạy thêm một lượt trên chính `AgentContext` cũ của subagent → nó thấy lại mọi tool call của lượt trước. Đang chạy → bảo thu bằng `TaskOutput` trước; đã chết → từ chối |

Ba tool này là **một phần của khả năng `Task`**: chỉ đăng ký khi `Task` được phép, theo đúng allowance của `Task`. Tách allowance riêng sẽ đẻ ra trạng thái "spawn được subagent nền nhưng không bao giờ thu được kết quả".

### Worktree cô lập cho subagent ([ADR 0083](../decisions/0083-pi-subagent-parity.md) §c)

`Task({ isolation: "worktree" })` cho subagent **một checkout + một branch riêng** thay vì dùng chung cây làm việc của phiên. Dùng khi nhiều subagent cùng **sửa file** một lúc; bỏ qua với việc chỉ-đọc (checkout sạch không có `node_modules`, `.env`, cache build).

Cơ chế là **đúng module của Task** ([`tasks/worktree.ts`](../../apps/desktop/sidecar/src/tasks/worktree.ts), [ADR 0081](../decisions/0081-task-node-worktree-isolation.md)) đã được tổng quát hoá sang khoá theo owner — **không** có bản worktree thứ hai:

| | Giá trị |
|---|---|
| Owner | `{ kind: 'session', id: <sessionId> }` |
| Thư mục | `~/.awog/session-worktrees/<sessionId>/worktrees/<toolCallId>` |
| Branch | `awog/session/<sessionId>/<toolCallId>` |
| Policy | `always` (cây gốc đang là cwd của chính lượt cha, không giành) |

**Chỉ cô lập, không tự merge.** `integrateTaskBranches()` chỉ nhận `taskId` — không có cách nào gọi nó cho owner `session`, đây là ràng buộc **kiểu** chứ không phải quy ước. Lý do: merge vào nhánh người dùng đang checkout là hành động Task đã có công tắc (auto-commit per-phase) và có "điểm ráo" để chạy; một lượt chat không có công tắc nào như thế, nên AWOG không được tự tạo commit rồi merge vào repo của người dùng. Cây làm việc của họ **không nhúc nhích một byte**; tool result nêu tên branch để model báo lại và người dùng tự `git merge`.

Vòng đời + dọn dẹp:

- Lease được cấp **trước** khi dựng toolset của subagent (checkout chính là root sandbox `assertInsideWorkspace` của nó), và **nhả ở cuối lượt cha** — không nhả sớm, vì `SendMessage` phải chạy tiếp trong đúng checkout đó. `disposeAll()` giờ `async`: nó `abortAll()` → chờ subagent dừng hẳn (trần 10s, abort chỉ *phát tín hiệu*, tool call đang bay vẫn ghi được file) → mới nhả worktree.
- Nhả = đúng lưới an toàn F8a của ADR 0081: còn thay đổi chưa lưu ⇒ `git add -A` + commit `WIP: rescued…` **trên branch của subagent** (chat không có auto-commit, nên đây là đường DUY NHẤT giữ lại việc nó vừa làm); cứu không được ⇒ **không xoá gì**, log `error` kèm đường dẫn.
- Branch **rỗng** (subagent chỉ đọc) bị `git branch -d` dọn — `-d` chứ không bao giờ `-D`, nên chính git từ chối xoá thứ còn commit. Không tích rác.
- App chết giữa lượt ⇒ `sweepOrphanWorktrees()` lúc boot bắt được: nó quét `listOwners()` = **cả** task **lẫn** session.
- Trần: **4** checkout cô lập sống cùng lúc trong một lượt (bằng trần subagent nền + trần scheduler của Task).

Degrade (đều **không** báo lỗi, chỉ ghi note vào tool result — việc vẫn phải xong): task node (`invoke.ts`) không có lease ⇒ chạy chung cây; không phải git repo / git < 2.20 / HEAD detached ⇒ chạy chung cây; chạm trần 4 ⇒ chạy chung cây. Giá trị `isolation` lạ (kể cả `"remote"` của Claude SDK — AWOG không có remote executor) thì **bounce** để model sửa.

### Vòng đời + trần

- Subagent nền **chết khi lượt cha kết thúc** (`disposeAll()` ở `finally` của vòng lặp trong [run-stream.ts](../../apps/desktop/sidecar/src/runtime/run-stream.ts)), và chết ngay khi người dùng bấm Stop (signal của lượt được nối vào từng subagent). Lý do: một phiên chỉ có **1 lượt tại một thời điểm** — subagent sống qua lượt sẽ gọi tool khi không còn lượt nào để hỏi quyền. Nhánh Claude SDK hứa với model đúng điều này.
- Trần: 25 spawn/lượt · **4** subagent nền song song · **30 phút** cho một subagent nền · ngân sách lượt (`withTurnBudget`) vẫn đếm tool call của subagent vì nó đi qua đúng `beforeToolCall` của cha.
- Task node (`invoke.ts`) **luôn chạy subagent đồng bộ**: one-shot, không có chỗ nào thu kết quả nền. Model xin chạy nền ở đó → degrade sang đồng bộ + ghi rõ trong kết quả.
- Subagent nền hiện thành **chip nền** qua chính `sessions/bg-registry.ts` (đường `registerExternalBackground` nhánh Claude SDK đang dùng) nên người dùng thấy một danh sách duy nhất và bấm dừng được. Bản đồng bộ không tạo chip.

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
| [runtime/tools/task-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/task-tool.ts) | **Mới** — `createTaskTool` + `prepareSubagent`; [ADR 0083](../decisions/0083-pi-subagent-parity.md) thêm `createSubagentTools` (Task + TaskOutput + TaskStop + SendMessage) |
| [runtime/subagents/model-tier.ts](../../apps/desktop/sidecar/src/runtime/subagents/model-tier.ts) | **Mới** ([ADR 0083](../decisions/0083-pi-subagent-parity.md) §a) — resolve TIER → model id theo account (hàm thuần) |
| [runtime/subagents/registry.ts](../../apps/desktop/sidecar/src/runtime/subagents/registry.ts) | **Mới** ([ADR 0083](../decisions/0083-pi-subagent-parity.md) §b/§e) — sổ đăng ký subagent theo lượt: nền, trần đồng hồ, stop, nhắn tiếp |
| [runtime/subagents/fork-history.ts](../../apps/desktop/sidecar/src/runtime/subagents/fork-history.ts) | **Mới** ([ADR 0083](../decisions/0083-pi-subagent-parity.md) §d) — cắt đuôi transcript cho `fork` |
| [runtime/subagents/worktree-lease.ts](../../apps/desktop/sidecar/src/runtime/subagents/worktree-lease.ts) | **Mới** ([ADR 0083](../decisions/0083-pi-subagent-parity.md) §c) — lease worktree của một lượt chat; nhả hết ở `disposeAll()` |
| [tasks/worktree.ts](../../apps/desktop/sidecar/src/tasks/worktree.ts) | Tổng quát hoá sang khoá theo owner (`task` \| `session`); sweeper quét cả hai; `git branch -d` branch rỗng lúc release |
| [runtime/__tests__/subagents.test.ts](../../apps/desktop/sidecar/src/runtime/__tests__/subagents.test.ts) | **Mới** — test tier / fork-trim / vòng đời registry |
| [runtime/tools/builtin-stubs.ts](../../apps/desktop/sidecar/src/runtime/tools/builtin-stubs.ts) | **Mới** — stub `TodoWrite`/`WebSearch` (WebFetch tách ra tool thật, [ADR 0042](../decisions/0042-webfetch-tool-ssrf-guarded.md)) |
| [runtime/tools/web-fetch-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/web-fetch-tool.ts) | **Mới** ([ADR 0042](../decisions/0042-webfetch-tool-ssrf-guarded.md)) — `createWebFetchTool` thật, SSRF-guarded |
| [runtime/tools/index.ts](../../apps/desktop/sidecar/src/runtime/tools/index.ts) | Export `isToolAllowed`; thêm stub + WebFetch vào base toolset |
| [sessions/step-mapper.ts](../../apps/desktop/sidecar/src/sessions/step-mapper.ts) | Thêm `stepFromTodos` (TodoWrite → step `note`) |
| [runtime/event-adapter.ts](../../apps/desktop/sidecar/src/runtime/event-adapter.ts) | Thêm `parentId` option (stamp step + nén onChunk khi child); special-case TodoWrite |
| [runtime/invoke.ts](../../apps/desktop/sidecar/src/runtime/invoke.ts) | `createInvokeAdapter(cb, parentId)` + wire Task tool |
| [runtime/run-stream.ts](../../apps/desktop/sidecar/src/runtime/run-stream.ts) | Wire Task tool (non-plan), thread `projectId`; [ADR 0083](../decisions/0083-pi-subagent-parity.md): dùng `createSubagentTools` + `disposeAll()` ở `finally` |
| [sessions/runner.ts](../../apps/desktop/sidecar/src/sessions/runner.ts) | `RunNonStreamArgs.projectId` |
| [methods/sessions.send-message.ts](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts) | Truyền `projectId` |
| [sdk/invoke.ts](../../apps/desktop/sidecar/src/sdk/invoke.ts) | `InvokeArgs.projectIds` + `connectionId` |
| [tasks/node-runner.ts](../../apps/desktop/sidecar/src/tasks/node-runner.ts) | Truyền `projectIds` + `connectionId` |

## Bảo mật (8 invariant)

- **API key không rời sidecar:** subagent resolve credential trong sidecar; key không vào step/trace/IPC payload.
- **Path/Git scope:** subagent fs/bash dùng cùng `cwd = workspaceRoot` + `assertInsideWorkspace`.
- **Budget:** depth = 1 + cap 25 spawn/turn + 4 subagent nền song song + 30 phút/subagent nền ([ADR 0083](../decisions/0083-pi-subagent-parity.md) §b). Nhiều `Task` trong một turn fan-out **song song** (xem [ADR 0030 §Cập nhật 2026-06-17](../decisions/0030-subagent-task-tool.md#cập-nhật-2026-06-17--song-song-hoá-task)); tool **bên trong** mỗi subagent vẫn chạy tuần tự.
- **IPC boundary / no eval / no SSRF:** không phát sinh surface mới (tái dùng tool + MCP hiện có).

## Việc còn lại

- Cập nhật chú thích `<mcp-preference>` (subagent **nay có** MCP riêng theo AGENT.md).
- (Tùy chọn) surface text tổng kết của subagent thành 1 step `note` nested.
- infosec review path spawn lồng + credential per-subagent (bao gồm prompt quyền của subagent **nền** — nó gọi tool khi người dùng đang đọc thứ khác).
- **§c worktree cô lập:** ✅ đã ship (xem mục trên). Còn lại: **UI chưa có surface** cho branch mà subagent để lại — hiện chỉ có tên branch trong tool result + `log.info`; cần một chỗ trong Workspace Panel liệt kê branch `awog/session/<id>/*` để bấm merge/xoá. Và infosec soi lại đường tạo branch/commit từ một lượt chat (path do sidecar sinh, arg array, không merge — nhưng nó *có* ghi vào `.git` của người dùng).
