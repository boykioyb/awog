# 0032 — Hook Execution Engine + IPC Contract

- **Trạng thái:** Accepted — v1 đang implement (2026-06-11). **Imported claude-* hook tiers superseded by [ADR 0035](./0035-consolidate-config-tiers-to-awog.md)** (2026-06-12: settings.json hooks thành nguồn import-only, không còn tier read-only sống). Engine + trust gate D-8 giữ nguyên.
- **Ngày:** 2026-06-11
- **Người quyết định:** Tech Lead

## Bối cảnh

Hooks hiện **chỉ là UI mock**: type [`Hook`/`HookEvent`](../../apps/desktop/ui/types/index.ts) + CRUD in-memory trong [`stores/workspace.ts`](../../apps/desktop/ui/stores/workspace.ts) (`saveHook`/`deleteHook`/`toggleHook`/`runHookOnce`), seed từ [`utils/initial-extensions.ts`](../../apps/desktop/ui/utils/initial-extensions.ts). **Không** có method `hooks.*` ở sidecar, **không** persist ra đĩa, **không** có nơi nào trong runtime fire event hay spawn hook command. `runHookOnce()` chỉ là `setTimeout` giả lập.

Spec đã có (Draft): [`hooks.md`](../features/hooks.md) — chốt taxonomy event, payload contract, matcher, run mode, bảo mật ở mức "what". ADR này chốt **contract bất biến** ("how") trước khi decompose + implement: **lifecycle anchor** (event fire ở đâu trong sidecar), RPC method, persistence tier, blocking semantics, và — quan trọng nhất — **trust model cho hook đến từ workspace** (supply-chain). Mirror cách [ADR 0024](./0024-task-execution-engine-ipc-contract.md) (Task Engine) và [ADR 0017](./0017-git-manager-ipc-contract.md) (Git Manager) đã làm.

Phải tuân thủ:

- [ADR 0008](./0008-stdio-ipc-for-sidecar.md) — UI ↔ sidecar qua stdio JSON-RPC 2.0; UI không tự spawn process.
- [ADR 0018](./0018-mcp-secret-keychain.md) — secret ref `${secret:KEY}` resolve qua OS keychain, không vào file/git.
- [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md) / [ADR 0030](./0030-subagent-task-tool.md) — runtime Pi SDK, `beforeToolCall` là permission gate hiện có.
- [`.claude/rules/security.md`](../../.claude/rules/security.md) — 8 invariant, đặc biệt **#2 path sanitize** (cwd ⊂ workspace), **#3 git scope**, **#4 IPC boundary**, **#8 no eval trên payload workspace/UI**.

> **Lưu ý invariant:** Hook = chạy shell command tùy ý với quyền user OS. Đây là điểm **căng nhất** với invariant #8 ("no eval/dynamic require trên payload từ workspace/UI"). ADR này không miễn trừ invariant — nó giới hạn rủi ro bằng **trust gate cho hook tier project** (D-8) và coi hook là feature opt-in của user, song song mô hình *Workspace Trust* của VS Code.

## Quyết định

### Decision summary (1 dòng / vấn đề)

| # | Vấn đề | Quyết định | Rationale |
|---|--------|------------|-----------|
| D-1 | Lifecycle anchor | **`HookDispatcher` tập trung** ở sidecar; fire tại các emit-point đã có ([`tasks/engine.ts`](../../apps/desktop/sidecar/src/tasks/engine.ts), [`runtime/run-stream.ts`](../../apps/desktop/sidecar/src/runtime/run-stream.ts)) + tool-call gate. **Không** rải `spawn` khắp nơi. | Một điểm match+spawn+audit; emit-point UI đã tồn tại sẵn → chỉ thêm 1 lời gọi `dispatch(event, payload)`. |
| D-2 | Tool-call hook | `tool.before-call` chui vào **`beforeToolCall`** Pi SDK đang dùng cho permission ([`runtime/permission.ts`](../../apps/desktop/sidecar/src/runtime/permission.ts)); thêm `afterToolCall` cho `tool.after-call`. Thứ tự: **permission gate → hook**. | Không có anchor thứ 2 cho tool; tái dùng callback có sẵn. Permission luôn quyết trước để hook không nới quyền. |
| D-3 | Persistence | **Per-file JSON, 2 tier** như Workflows ([ADR 0024](./0024-task-execution-engine-ipc-contract.md) D-3): global `~/.awog/hooks/<id>.json` + project `{project.path}/.awog/hooks/<id>.json`. `source`/`projectId` suy ra từ vị trí. **Supersede** `workspace/hooks/` của spec. | Đồng nhất convention Agents/Skills/Workflows; project-tier đi theo repo. |
| D-4 | RPC granularity | **Per-command** `hooks.{list,upsert,delete,toggle,runOnce,trust}`. Typed + zod validate riêng từng method (như `git.*`/`mcp.*`). | Nhất quán; bỏ mock store in-memory, UI gọi sidecar thật. |
| D-5 | Run audit / streaming | Run record append **JSONL** `~/.awog/hooks/.runs/<id>.jsonl` (rolling 1000 dòng, không git). Emit `hook.run` event qua kênh `sidecar-event` hiện có. | O(1) append, restart-safe; UI live qua listener có sẵn ([ADR 0024](./0024-task-execution-engine-ipc-contract.md) D-5). |
| D-6 | Blocking semantics | Chỉ event `*.before-*` + `tool.before-call` block được. `runMode:'blocking'` + exit ≠ 0 → **abort hành động** đi kèm, surface stderr. `background` = fire-and-forget, không bao giờ abort. Timeout → kill, treat exit 124. | Khớp spec; deterministic. Background không block để không treo task nền. |
| D-7 | Template + injection safety | Payload **luôn** đẩy qua **stdin** (`JSON.stringify`). `{{...}}` trong `command` thay bằng giá trị **shell-quoted** (single-quote wrap + escape). `${secret:...}` **chỉ** expand trong `env`, **không** trong `command`. `${workspace}` resolve ở sidecar. | Chặn command injection từ payload L1 (path do model/file đặt tên); secret không lọt vào process arg list. |
| D-8 | **Trust model (project tier)** | Hook tier **project** = **disabled khi mới discover**, chờ user duyệt qua `hooks.trust` (UI liệt kê hook + command đầy đủ). Hook tier **global** (do user tự tạo local) = trusted. | **Supply-chain**: clone repo lạ chứa `.awog/hooks/*.json` ⇒ RCE khi mở project nếu auto-run. Gate giống *Workspace Trust*. **HARD BLOCK** nếu thiếu. |
| D-9 | Ordering | Nhiều hook cùng event → chạy **tuần tự theo `id` alphabet**. Một fail (non-block) → hook sau vẫn chạy. **Defer** `priority` field. | Deterministic, YAGNI; user prefix nếu cần thứ tự. |
| D-10 | Failure handling | Log + surface UI. **Không** auto-disable sau N fail ở v1. | YAGNI; tránh tự tắt hook quan trọng (vd block-gitignored) do lỗi tạm. |
| D-11 | Integration scheduler | Trong [`tasks/engine.ts`](../../apps/desktop/sidecar/src/tasks/engine.ts): blocking hook trên `phase.*`/`artifact.before-write` **serialize trong node-runner** (await trước khi tiếp). Trong session/task `bypassPermissions` ([ADR 0024](./0024-task-execution-engine-ipc-contract.md) D-7), `*.before-*` block ⇒ abort phase + phase `failed`. | Hook chạy nền vẫn enforce được; không cần UI mở. |
| D-12 | Event scope v1 | **v1 ship**: `task.*`, `phase.*`, `artifact.*`, `tool.*`, `session.reset`, `mcp.server-error`. **Defer v2**: `agent.before-prompt` *modify* messages (token re-count). v1 chỉ block, **không** modify payload. | Modify-prompt mở rủi ro token/loop; chốt block-only trước, modify là additive. |

### Chi tiết quyết định

#### D-1 — `HookDispatcher` + anchor

```ts
// apps/desktop/sidecar/src/hooks/dispatcher.ts
async function dispatch(event: HookEvent, payload: HookPayload, opts?: { projectId?: string }):
  Promise<{ blocked: boolean; stderr?: string }>
```

Anchor (chỉ thêm 1 lời gọi `dispatch` tại mỗi điểm — engine **không** tự spawn):

| Event | Anchor file:vị trí | Block |
|---|---|---|
| `task.before-start` / `task.after-complete` | `tasks/engine.ts` quanh transition `queued→running` / `→completed\|failed` | before ✓ |
| `phase.before-run` / `phase.after-run` | node-runner trước dispatch / sau output | before ✓ |
| `phase.before-approve` / `phase.after-approve` | `tasks/*.approvePhase` | before ✓ |
| `artifact.before-write` / `artifact.after-write` | bao quanh `fs.writeFile` đã qua `assertInsideWorkspace` | before ✓ |
| `tool.before-call` / `tool.after-call` | `runtime/permission.ts` (`beforeToolCall`) + nhánh after mới | before ✓ |
| `agent.after-response` | `runtime/run-stream.ts` sau `agent_end` | ✗ |
| `mcp.server-error` | `mcp/manager` on exit ≠ 0 | ✗ |
| `session.reset` | `sessions/store.ts` reset | ✗ |

`dispatch` = `loadHooksForEvent(event, projectId)` → filter `enabled && trusted && matchMatcher` → sort theo `id` → spawn tuần tự (blocking) / fan-out (background) → append run record + emit `hook.run`.

#### D-7 — Pipeline render command (chống injection)

```
raw:     pnpm exec prettier --write {{event.payload.path}}
payload: { path: "/ws/a'; rm -rf ~ #.ts" }          // path L1, không tin
render:  pnpm exec prettier --write '/ws/a'\''; rm -rf ~ #.ts'   // single-quote escaped
stdin:   {"event":"artifact.after-write","payload":{"path":"..."}}   // luôn có, nguồn chuẩn
```

Hook nên đọc payload từ **stdin** (chuẩn, đầy đủ); `{{...}}` chỉ là tiện ích và **luôn** được shell-quote. `${secret:...}` không bao giờ xuất hiện trong `command` đã render (reject ở `upsert` nếu phát hiện).

#### D-8 — Trust gate (chi tiết)

- File hook project-tier load lên ở trạng thái `trusted:false` (cờ runtime trong store, **không** ghi vào file JSON — nguồn không tự phong tin cho chính nó).
- Lần đầu phát hiện hook project chưa duyệt → emit `hook.untrusted` → UI banner: *"Project này khai báo N hook chạy shell command. Xem & duyệt?"* liệt kê `name + command` từng hook.
- `hooks.trust({ scope:'project', projectId, hookIds })` set trusted (persist quyết định trust ở `{project}/.awog/.trust.json`, không phải trong hook file).
- Hook chưa trusted **không bao giờ** spawn (kể cả `runOnce`).
- Hook global trusted mặc định (user tự tạo trên máy mình = L3).

## Phương án đã cân nhắc

- **Rải `spawn` trực tiếp tại mỗi emit-point** — bị từ chối: trùng logic match/quote/audit ở ~8 chỗ, dễ sót invariant. `HookDispatcher` tập trung (D-1).
- **Hook config trong `.claude/settings.json` (giống Claude Code)** — bị từ chối: `.claude/` là của Claude Code (con người), không phải data layer AWOG; lệch convention per-file 2-tier của Agents/Skills/Workflows (D-3).
- **Tin mọi hook trong workspace (như global)** — **bị từ chối dứt khoát**: clone repo độc hại ⇒ RCE im lặng khi mở project. Trust gate (D-8) là bắt buộc.
- **Substitute `{{...}}` thẳng vào command string không escape** — bị từ chối: path/tên file do model/file đặt = command injection (D-7).
- **Modify payload qua stdout JSON ngay v1** (spec gợi ý cho `agent.before-prompt`) — defer v2: cần re-validate token, dễ gây loop; v1 block-only (D-12).
- **Auto-disable hook sau N fail** (giống MCP) — defer: rủi ro tự tắt guard quan trọng; v1 chỉ surface (D-10).
- **JS hook in-process** — out of scope (đã chốt ở spec): subprocess only.

## Hệ quả

- **Tích cực:**
  - Tái dùng emit-point + `beforeToolCall` + JSONL store + `sidecar-event` đã chín → ít code mới.
  - 2-tier persistence cho phép hook đi theo repo (project) lẫn dùng chung (global), nhất quán toàn hệ.
  - Trust gate biến rủi ro RCE supply-chain thành quyết định tường minh của user.
- **Tiêu cực / Trade-off:**
  - **Hook = arbitrary code execution** (rủi ro chính). Giảm thiểu: trust gate D-8, cwd sanitize, secret chỉ trong env, cảnh báo UI lần đầu. Cần **infosec review trước release** (path expansion, quote escaping, trust bypass, secret leak qua process list).
  - Blocking hook trên hot-path (`tool.before-call`, `artifact.before-write`) thêm latency mỗi tool call → khuyến nghị timeout thấp + ưu tiên `background`.
  - `hook.run`/`tool.before-call` volume cao với task nhiều tool → coalesce/throttle event như `task.run.trace`.
  - RTK ([ADR 0031](./0031-rtk-token-proxy.md)) **không** áp cho hook command (RTK chỉ bọc Bash tool); output hook không nén — giữ stderr ngắn.
- **Edit hook SCRIPT file (Amended 2026-06-11):** với hook chạy file script (command trỏ tới `.sh`/`.mjs`/…), editor cho **sửa nội dung file script** inline ([`hooks/script.ts`](../../apps/desktop/sidecar/src/hooks/script.ts) + `hooks.read-script`/`hooks.write-script`). Phát hiện script token trong command, resolve theo workspace (`$CLAUDE_PROJECT_DIR`/`~`/relative), **chỉ đọc/ghi trong thư mục hook hợp lệ** (`{ws}/.claude/hooks`, `{ws}/.awog/hooks`, `~/.claude/hooks`, `~/.awog/hooks`) — chặn path khác. Áp cho native + imported.
- **Edit imported hooks (Amended 2026-06-11):** imported hook **edit được trong app** — sửa `command`/`matcher`/`timeout`, ghi vá đúng entry trong `.claude/settings.json` (`updateImportedHookInFile`): match theo id sinh lại, reverse matcher glob→regex, timeoutMs→giây, GIỮ NGUYÊN phần còn lại của file. Field khác (event/runMode/cwd/env/enabled/name) khoá. (User đảo quyết định read-only ban đầu.)
- **Import Claude Code hooks (Amended 2026-06-11):** ngoài 2 tier AWOG-native (global/project), Hooks còn **import read-only** từ Claude Code `settings.json` — `claude-user` (`~/.claude/settings.json`), `claude-project` (`{project}/.claude/settings.json`), `claude-local` (`.../settings.local.json`). Map `PreToolUse→tool.before-call`, `PostToolUse→tool.after-call` (các event khác bỏ qua); matcher regex CC (`Edit|Write`) → glob AWOG (`{Edit,Write}`); imported chạy với **stdin shape Claude Code** (`{hook_event_name,tool_name,tool_input,cwd}`) + `$CLAUDE_PROJECT_DIR` để script CC (vd `format-after-edit.sh`) hoạt động nguyên trạng. Imported project (`claude-project`/`claude-local`) **trust-gated** như project tier (D-8); `claude-user` trusted. Dispatch **ưu tiên project trước global** (sort tier rồi id). UI: read-only (ẩn edit/delete/run/toggle), badge Lock + source label, gom theo project + collapse như Skills.
- **Anchor scope v1 (đã wire):** `tool.before-call`/`tool.after-call` + `artifact.before-write`/`artifact.after-write` (qua wrap `createRuntimeToolDefinitions` — phủ cả session lẫn task, gồm built-in + MCP tool; artifact.* chỉ Write/Edit) + `task.after-complete` + `phase.after-approve` (chèn ở `tasks/engine.ts`). Bộ này phủ đủ 5 use case mẫu (prettier, block-gitignored, slack, auto-commit, audit). **Anchor defer follow-up:** `task.before-start` (API sync), `phase.before-run`/`phase.after-run`, `phase.before-approve`, `agent.*`, `mcp.server-error`, `session.reset` — dispatcher generic nên thêm anchor sau chỉ là 1 lời gọi `dispatch`.
- **Việc cần làm tiếp:**
  - Bỏ `INITIAL_HOOKS` mock + chuyển `stores/workspace.ts` hook actions sang gọi `hooks.*` (hoặc tách `stores/hooks.ts` như tasks/workflows).
  - Nâng [`hooks.md`](../features/hooks.md) Draft → Approved; resolve Open Questions theo D-8/D-9/D-10/D-12; thêm checklist `hook-engine.tasks.md`.
  - infosec audit (agent `infosec` + skill `security-audit`) trên dispatcher + render + trust gate trước release.
  - Cập nhật [data-model.md](../architecture/data-model.md) (hook file layout) + [execution-model.md](../architecture/execution-model.md) (hook trong vòng đời phase/tool).

## Tham chiếu

- [ADR 0008](./0008-stdio-ipc-for-sidecar.md), [ADR 0017](./0017-git-manager-ipc-contract.md), [ADR 0018](./0018-mcp-secret-keychain.md), [ADR 0024](./0024-task-execution-engine-ipc-contract.md), [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md), [ADR 0030](./0030-subagent-task-tool.md)
- Feature: [hooks](../features/hooks.md), [task-execution-engine](../features/task-execution-engine.md), [artifact-system](../features/artifact-system.md), [agent-trace](../features/agent-trace.md), [settings](../features/settings.md)
- Security: [`.claude/rules/security.md`](../../.claude/rules/security.md) (8 invariant + sink/source L1)
