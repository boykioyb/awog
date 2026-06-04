# 0024 — Task Execution Engine + Workflow IPC Contract

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-03
- **Người quyết định:** Tech Lead

## Bối cảnh

Tasks và Workflows là phần cuối của MVP còn ở dạng **mock**: toàn bộ state + logic nằm trong [`stores/workspace.ts`](../../apps/desktop/ui/stores/workspace.ts), execution mô phỏng bằng `setTimeout`, nội dung lấy từ [`utils/mock-output.ts`](../../apps/desktop/ui/utils/mock-output.ts). Sidecar chưa có method `tasks.*` / `workflows.*`.

Cần biến chúng thành tính năng **end-to-end thật**: workflow DAG persist ra đĩa; task chạy thật qua `@anthropic-ai/claude-agent-sdk` (mỗi node = 1 lượt agentic); sinh artifact + git auto-commit; trace/status stream realtime về UI; approve/rerun/discussion thật; sống sót qua restart.

Spec đã có (Draft): [`task-execution-engine.md`](../features/task-execution-engine.md), [`workflow-builder.md`](../features/workflow-builder.md), [`human-approval.md`](../features/human-approval.md), [`artifact-system.md`](../features/artifact-system.md), [`agent-trace.md`](../features/agent-trace.md). Pattern tham chiếu đã wire đủ: **Sessions** ([`sessions/runner.ts`](../../apps/desktop/sidecar/src/sessions/runner.ts) + [`sessions/store.ts`](../../apps/desktop/sidecar/src/sessions/store.ts) + [`sessions.send-message.ts`](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts) + [`stores/sessions.ts`](../../apps/desktop/ui/stores/sessions.ts)).

ADR này chốt **contract bất biến** (RPC method, event, persistence, scheduler semantics) trước khi decompose task + implement. Phải tuân thủ:

- [ADR 0004](./0004-artifacts-as-source-of-truth.md) — artifact là source of truth, không truyền agent-to-agent.
- [ADR 0008](./0008-stdio-ipc-for-sidecar.md) — UI ↔ sidecar qua stdio JSON-RPC 2.0.
- [ADR 0017](./0017-git-manager-ipc-contract.md) — git per-command, mutex per workspace, auto-commit scope `workspace`.
- [`.claude/rules/security.md`](../../.claude/rules/security.md) — 8 invariant (đặc biệt #1 key isolation, #2 path sanitize, #3 git cwd, #4 IPC boundary).

## Quyết định

### Decision summary (1 dòng / vấn đề)

| # | Vấn đề | Quyết định | Rationale |
|---|--------|------------|-----------|
| D-1 | Concurrency model | **Parallel scheduler** — node runnable khi mọi upstream `completed`; cap `CONCURRENCY_CAP=4` node/task chạy đồng thời. **Supersede** "single worker sequential" của [execution-model.md](../architecture/execution-model.md). | User yêu cầu parallel thật; nhánh độc lập (REV/QA sau DEV) chạy cùng lúc → giảm wall-clock. |
| D-2 | Task persistence | **Event-sourced JSONL** `tasks/<id>/events.log` (source of truth) + `task.json` snapshot cache (`fold`) + `artifacts/`. Clone pattern [`sessions/store.ts`](../../apps/desktop/sidecar/src/sessions/store.ts). | O(1) append, crash-safe, nhiều node song song append an toàn qua per-task lock; restart = fold + schedule. |
| D-3 | Workflow persistence | **JSON snapshot, 2 tier** (như Skills/Agents): `global` → `~/.awog/workflows/<id>.json` (dùng chung), `project` → `{project.path}/.awog/workflows/<id>.json` (đi theo repo, git-track). `source`/`projectId` suy ra từ vị trí, **không** lưu trong JSON. Validate no-cycle khi upsert. | Workflow là template tĩnh → event-sourcing thừa; per-project cho phép workflow riêng repo + global tái dùng xuyên project. |
| D-4 | RPC granularity | **Per-command** `workflows.{list,upsert,delete}` + `tasks.{list,get,create,delete,approvePhase,rerunPhase,discuss,cancel}`. | Typed, zod validate riêng từng method (giống `git.*`). |
| D-5 | Streaming protocol | **JSON-RPC notification** channel `sidecar-event` hiện có, shape `{ type: 'task.<domain>', payload }`. Mỗi event ↔ 1 `TaskEvent` đã append. | Reuse `transport/stdio.emit` + `useSidecar().onEvent`; UI live = fold snapshot. |
| D-6 | SDK core reuse | **Trích `sdk/invoke.ts`** từ `sessions/runner.ts` (account/auth/buildOptions/event-loop). `runStream` (chat) + `node-runner` (task) cùng gọi core. | DRY; zero behavioral change cho chat; 1 contract SDK. |
| D-7 | Trust model permission | Task chạy nền với `permissionMode: bypassPermissions`; tool gating qua `agent.tools` (workflow author chịu trách nhiệm). **Không** park UI permission prompt như chat. | Task chạy ở tray/nền, có thể không có UI mở để duyệt. |
| D-8 | Git auto-commit | Reuse [`autoCommitPhase`](../../apps/desktop/sidecar/src/git/auto-commit.ts) (`scope:'workspace'`), cwd = **project path**. Engine không tự spawn git. | Helper đã sẵn (mutex reentrant, no-change skip, template); giữ đúng ADR 0017 D-3. |
| D-9 | Parallel + git contention | **Node ghi-code nối tuần tự trong DAG**; nhánh song song dành cho read/analysis sinh `.md` artifact. Commit step serialize qua `withWorkspaceLock`. | Tránh `git add -A` của node song song nuốt change chưa commit của node kia (xem Hệ quả). |
| D-10 | Rerun downstream set | **Reachability BFS** từ node trigger theo edge (KHÔNG `topoSort.slice` như mock). | `slice` over-invalidate diamond DAG — kéo theo node không liên quan. |
| D-11 | Agent resolution trên node | **Mở rộng `WorkflowNode`** thêm `agentSource` + `agentProjectId?`. | `loadAgent(id, source, projectId)` cần đủ identity tuple; `agentId` đơn lẻ ambiguous giữa các tier. |
| D-12 | `waiting_connection` | **Defer** ([ADR 0010](./0010-pause-on-quota-for-connection-switch.md)). Giữ field optional/nullable, không build producer. | Tập trung core engine; thêm producer sau là additive (catch quota trong `invoke.ts`). |

### Chi tiết quyết định

#### D-1 — Parallel scheduler + join semantics

Precompute `upstream: Map<nodeId, nodeId[]>` từ edges. Node **runnable** ⇔ phase `pending` **và** mọi node trong `upstream[nodeId]` có phase `completed`.

```
schedule(task):
  loop:
    runnable = nodes pending && upstream all completed
    while inFlight.size < CONCURRENCY_CAP && runnable not empty:
      pick node → phase running (append phase.status) → dispatch nodeRunner → inFlight
    if inFlight empty && runnable empty: break          // terminal
    await Promise.race(inFlight)                          // wake on next completion → recompute
```

- **Approval gate**: node có `approval:true` khi xong → run + phase = `waiting_approval` (KHÔNG `completed`) → không thỏa join downstream, nhưng nhánh sibling vẫn chạy. Scheduler đạt terminal với vài phase parked → task status `waiting_approval`, suspend. `approvePhase` re-enter `schedule`.
- **Failure**: node fail → phase/run `failed`; downstream (reachability BFS) `failed`; sibling in-flight chạy nốt; không dispatch thêm → task `failed`. Không auto-retry (MVP).
- **Cancel**: abort mọi `AbortController` in-flight (per `(taskId,nodeId)`); running phase → `failed`; task `failed`.

#### D-2 — Task persistence (`tasks/store.ts`)

`TaskEvent` union (append-only, fold deterministic):

```ts
type TaskEvent =
  | { type:'task.created';     at; task: Task }                                  // phases seeded pending, status queued
  | { type:'task.status';      at; status: TaskStatus; waitingApproval?: string|null }
  | { type:'phase.status';     at; nodeId; status: PhaseStatus }
  | { type:'run.started';      at; nodeId; version; triggeredBy?: 'rerun' }
  | { type:'run.status';       at; nodeId; version; status: RunStatus; duration?: string|null }
  | { type:'run.output';       at; nodeId; version; output: string }
  | { type:'run.approved';     at; nodeId; version; approvedBy:'human'|'auto'; approvedAt }
  | { type:'trace.node';       at; nodeId; version; node: TraceNode; parentId?: string|null }  // upsert by node.id
  | { type:'message.appended'; at; nodeId; version; message: Message }
  | { type:'artifact.written'; at; nodeId; version; path; bytes; commitSha? }
  | { type:'task.deleted';     at }                                              // tombstone → fold returns null
```

`task.json` = `fold(events)` ghi atomic sau mỗi append (best-effort cache; log thắng). Trace payload truncate (reuse `RESULT_PREVIEW_MAX=2000` từ [`step-mapper.ts`](../../apps/desktop/sidecar/src/sessions/step-mapper.ts)) để `task.json` reviewable trong git workspace AWOG.

#### D-5 — Event contract (emit về UI)

| Event | Payload | Khi nào |
|---|---|---|
| `task.status` | `{ taskId, status, waitingApproval }` | task transition |
| `task.phase.status` | `{ taskId, nodeId, status }` | phase transition (primitive cho parallel) |
| `task.run.started` | `{ taskId, nodeId, version, agentId, triggeredBy? }` | run mới |
| `task.run.trace` | `{ taskId, nodeId, version, node, parentId? }` | mỗi trace node create/update (high-freq) |
| `task.run.output` | `{ taskId, nodeId, version, delta? , output? }` | artifact text stream / final |
| `task.run.done` | `{ taskId, nodeId, version, status, duration, approvedBy?, approvedAt? }` | run kết thúc |
| `task.artifact.written` | `{ taskId, nodeId, version, path, name, commitSha? }` | sau write + commit |
| `task.message` | `{ taskId, nodeId, version, message }` | discussion message |

UI subscribe **1 listener app-lifetime** (KHÔNG per-send như chat) trong [`app.vue`](../../apps/desktop/ui/app.vue) vì task chạy nền sống qua navigation. Route theo `taskId/nodeId/version`. rAF output buffer keyed per-run.

#### D-6 — `sdk/invoke.ts` extraction

Move khỏi `runner.ts`: `resolveAccount`, `buildOptions`, `THINKING_BUDGETS`/`MODE_PERMISSION`, `mapSdkErrorToRpc`, vòng `for await (query())`. Signature:

```ts
invokeSdk(args: { prompt, settings, systemPrompt?, allowedTools?, disabledTools?, mcpServers?, cwd?, abortController?, canUseTool? },
          cb: { onText?, onToolUse?, onToolResult?, onThinking?, onAssistantMeta? }):
  Promise<{ text, modelUsed, usage, stopReason }>
```

`runStream` (chat) = transcript render → `invokeSdk` (onText→onChunk, onTool*→step-mapper→onStep) + giữ `withSessionLock` + resume riêng. `node-runner` gọi `invokeSdk` trực tiếp với trace callbacks (gồm `onThinking` mà chat bỏ qua).

## Phương án đã cân nhắc

- **Single worker sequential** (execution-model.md gốc) — bị từ chối: user yêu cầu parallel thật; lãng phí wall-clock khi REV/QA độc lập.
- **Task persistence dạng snapshot-only `task.json`** — bị từ chối: nhiều node song song rewrite-per-mutation → lost update + rewrite lớn; JSONL append + per-task lock đúng hơn (lý do Sessions chọn JSONL).
- **Reuse `runStream` as-is cho node** — bị từ chối: nó hard-bind `withSessionLock(sessionId)`, aborter theo `messageId`, render transcript, làm resume dance — sai lifecycle cho node one-shot. Trích core sạch hơn.
- **Real parallel cả node ghi-code** — bị từ chối ở v1: `git add -A` race (D-9). Defer per-node pathspec staging (`artifacts-only` scope) sang v2.
- **Park UI permission cho task** (giống chat) — bị từ chối: task nền có thể không có UI; gating qua `agent.tools` đủ cho MVP.

## Hệ quả

- **Tích cực:**
  - Reuse tối đa hạ tầng Sessions/Git đã chín (runner core, JSONL store, autoCommitPhase, step-mapper, path-sanitize) → ít code mới, ít rủi ro.
  - Event-sourcing → restart-safety gần như free ("fold + schedule").
  - Parallel → wall-clock ngắn hơn cho workflow có nhánh độc lập.
  - Contract mirror `session.*` → UI áp dụng pattern đã kiểm chứng.
- **Tiêu cực / Trade-off:**
  - **Git contention (rủi ro chính)**: 2 node song song cùng sửa 1 project repo → `git add -A` của node này nuốt change chưa commit của node kia. Mitigation D-9: workflow author nối tuần tự node ghi-code; song song dành cho read/analysis. Cần infosec/TL theo dõi; v2 chuyển per-node pathspec.
  - **Two git trees**: code thật commit vào project repo; artifact `.md` summary lưu `~/.awog/tasks/<id>/artifacts/` + `events.log` (không vào project git). Đúng v1 scope `autoCommitPhase`.
  - `bypassPermissions` cho task nền là quyết định trust — phụ thuộc `agent.tools` đúng.
  - Trace event volume cao (node nhiều tool) → cân nhắc coalesce running→done trước persist.
- **Việc cần làm tiếp:**
  - Cập nhật [execution-model.md](../architecture/execution-model.md) phần Concurrency.
  - Nâng 4 spec Draft → Approved + checklist [`task-workflow-engine.tasks.md`](../features/task-workflow-engine.tasks.md).
  - Implement theo plan 6 phase; infosec review `bypassPermissions` + git contention trước release.
  - ADR 0010 (`waiting_connection`) wire sau như layer additive trên `invoke.ts`.

## Tham chiếu

- [ADR 0004](./0004-artifacts-as-source-of-truth.md), [ADR 0008](./0008-stdio-ipc-for-sidecar.md), [ADR 0010](./0010-pause-on-quota-for-connection-switch.md), [ADR 0017](./0017-git-manager-ipc-contract.md), [ADR 0023](./0023-sdk-session-resume-and-compact.md)
- Feature: [task-execution-engine](../features/task-execution-engine.md), [workflow-builder](../features/workflow-builder.md), [human-approval](../features/human-approval.md), [artifact-system](../features/artifact-system.md), [agent-trace](../features/agent-trace.md)
- Architecture: [data-model](../architecture/data-model.md), [execution-model](../architecture/execution-model.md)
