# Task/Workflow Engine — Task Decomposition

Checklist triển khai theo [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md). Owner: TL = tech-lead, D = developer, Q = qa-tester, R = code-reviewer.

> **Trạng thái:** Phase 0–5 (D) đã implement — sidecar typecheck/build sạch, UI lint/typecheck sạch. Còn lại: QA end-to-end (cần Tauri + tài khoản), infosec review (`bypassPermissions` + git contention), code review, và (tùy chọn) tách `useTasksManager`/`useWorkflowsManager`.

## Phase 0 — Docs ✅

- [x] ADR 0024 — engine IPC contract (TL)
- [x] Cập nhật `execution-model.md` (parallel scheduler + restart)
- [x] Nâng 4 spec Draft → Approved
- [x] Checklist này

## Phase 1 — Workflow persistence

- [ ] `sidecar/src/workflows/store.ts` — load/list/save/delete JSON snapshot (clone `projects/store.ts`) (D)
- [ ] `validateWorkflow()` — unique id, edge ref, no-cycle (Kahn), agent/skill assigned (D)
- [ ] `methods/workflows.{list,upsert,delete}.ts` + register `index.ts` (D)
- [ ] `types/index.ts` — `WorkflowNode.agentSource` + `agentProjectId?` (D)
- [ ] UI `stores/workflows.ts` — hydrate + CRUD optimistic + debounce persist (D)
- [ ] `composables/useWorkflowsManager.ts` + refactor `pages/workflows/index.vue` (D)
- [ ] WorkflowInspectorPane lưu agent source tuple khi chọn agent (D)

## Phase 2 — Task persistence + scaffolding

- [ ] `sidecar/src/tasks/store.ts` — JSONL event-sourced (`TaskEvent` union, fold, per-task lock, snapshot cache) (D)
- [ ] `methods/tasks.{list,get,create,delete}.ts` + register (D)
- [ ] UI `stores/tasks.ts` — hydrate + CRUD (clone `sessions.ts`) (D)
- [ ] `composables/useTasksManager.ts` + refactor `pages/tasks/index.vue` (D)
- [ ] `types/index.ts` — `Task*Event` payload types; bỏ `currentNodeId` (derive runningPhaseIds) (D)

## Phase 3 — Execution engine

- [ ] `sidecar/src/sdk/invoke.ts` — trích core từ `runner.ts`; `runner.ts` import lại (zero chat behavior change) (D)
- [ ] `sidecar/src/tasks/agent-context.ts` — trích agent+skill+MCP resolution từ `sessions.send-message.ts` (D)
- [ ] `sidecar/src/tasks/trace-mapper.ts` — SDK event → TraceNode tree (sibling step-mapper) (D)
- [ ] `sidecar/src/tasks/node-runner.ts` — 8 bước per-node + autoCommitPhase + artifact write (D)
- [ ] `sidecar/src/tasks/scheduler.ts` — runnable-set + cap + join + fail propagation (D)
- [ ] `sidecar/src/tasks/engine.ts` — registry + start/cancel + AbortController per (taskId,nodeId) (D)
- [ ] `tasks.create` gọi `engine.start`; emit events qua `task.*` (D)

## Phase 4 — UI live wiring

- [ ] `app.vue` — `tasksStore.subscribe()` app-lifetime + teardown (D)
- [ ] `stores/tasks.ts` — onEvent router (parallel-safe, rAF per-run buffer, trace upsert) (D)
- [ ] Replace mock actions → RPC (xóa setTimeout sim, gói vào `!sidecar.available` fallback) (D)
- [ ] `components/phase/PhaseOutputTab.vue` — real artifact qua `useFsApi().readFile` (D)

## Phase 5 — Approval / Rerun / Discussion + restart

- [ ] `methods/tasks.{approvePhase,rerunPhase,discuss,cancel}.ts` + engine logic (D)
- [ ] rerun reachability BFS; supersede + invalidate downstream; seed instruction (D)
- [ ] discuss = invokeSdk Q&A nhẹ, không tạo run/supersede (D)
- [ ] `engine.resumeOnBoot` gọi trong `index.ts` (D)

## Phase 6 — Verify

- [ ] Cập nhật `CLAUDE.md` + `apps/desktop/ui/README.md` (docs-sync)
- [ ] `pnpm lint && pnpm typecheck` (UI) + sidecar `tsc` (D)
- [ ] QA: 9 kịch bản verify end-to-end (xem plan) (Q)
- [ ] infosec: review `bypassPermissions` + git contention (infosec)
- [ ] code-reviewer: review diff trước merge (R)
