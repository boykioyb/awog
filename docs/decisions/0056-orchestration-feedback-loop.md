# 0056 — Orchestration Feedback Loop (Gate node + Verdict + auto loop-back)

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-27
- **Người quyết định:** tech-lead + user

## Bối cảnh

Task Execution Engine ([ADR 0024](0024-task-execution-engine-ipc-contract.md)) chạy workflow như một **DAG acyclic, tuyến tính/song song**. Khi node QA/Reviewer phát hiện lỗi, **không có vòng feedback tự động** quay về Developer để sửa rồi chạy lại — người dùng phải bấm **Rerun from here** thủ công ([task-execution-engine.md](../features/task-execution-engine.md) ghi rõ "Không auto-retry (MVP)").

Ba rào cản gốc trong code hiện tại:

1. `WorkflowEdge = { from, to }` — không điều kiện; DAG bắt buộc acyclic ([scheduler.ts](../../apps/desktop/sidecar/src/tasks/scheduler.ts) cycle-free join semantics) → không biểu diễn được cạnh QA → dev.
2. `NodeRunOutcome = 'completed' | 'waiting_approval' | 'failed'` — `failed` là **lỗi run kỹ thuật** (SDK throw/abort, [node-runner.ts:326](../../apps/desktop/sidecar/src/tasks/node-runner.ts)), KHÔNG phải "QA phán lỗi". Một QA run tìm ra bug vẫn `completed`.
3. Không có **verdict máy đọc được** → scheduler không có dữ liệu để rẽ nhánh/lặp.

Ràng buộc:
- Local-first, không database; persist = JSONL/JSON; **restart-safe**.
- Giữ DAG acyclic (đừng đập vỡ scheduler/cascade/cycle-detect đang chạy ổn).
- **Có trần** chống cháy token (security: "loop gọi model → budget per task").
- Giữ triết lý *human = guild master*: luôn có đường escalate sang người.
- Tái dùng tối đa hạ tầng sẵn có (rerun cascade, approval park, run versioning).

## Quyết định

Thêm **gate node có verdict** + **chỉ thị loop-back ở cấp engine**, KHÔNG thêm cạnh chu trình vào DAG.

### 1. Verdict tách khỏi RunStatus

Thêm `verdict?: 'pass' | 'fail'` vào `TaskRun`. Gate run **vẫn `completed`** (nó chạy xong) nhưng mang verdict. `node-runner` parse fenced block cuối:

````
```verdict
status: fail
summary: <một dòng>
```
````

Output là trust **L1** → parse defensive; **thiếu/sai block trên gate → escalate sang người** (`waiting_approval`), không bao giờ auto-loop trên parse lỗi.

### 2. Gate = field tùy chọn trên node (không phải node type mới)

```ts
interface NodeGate {
  onFailTarget: string    // ancestor của gate trong DAG (gate ∈ downstreamOf(onFailTarget))
  maxIterations: number   // trần vòng; clamp ≤ MAX_GATE_ITERATIONS_CEILING (=10)
  auto: boolean           // true = engine tự lặp; false = chỉ báo verdict, người tự Rerun
}
// WorkflowNode thêm: gate?: NodeGate   (shared.ts + ui/types, mirror)
```

### 3. Auto loop-back = tái dùng `rerunPhase`

Khi gate verdict = fail và còn lượt: engine gọi lại logic `rerunPhase(onFailTarget, instruction = gate.output)` với `triggeredBy: 'auto-loop'`. Instruction = **toàn bộ output gate** (bug report đầy đủ, cap 8k như `<linked_task>`) để dev đủ ngữ cảnh sửa đúng. `downstreamOf(onFailTarget)` đã invalidate đúng cả path dev → … → gate (run cũ `superseded`, phase `pending`), scheduler re-flow → gate chạy lại → parse verdict lần nữa. **Không cạnh chu trình** — vòng lặp là chỉ thị trên node, edges vẫn acyclic.

### 4. Đếm vòng = event-sourced

Số vòng đã chạy = số run trên `onFailTarget` có `triggeredBy === 'auto-loop'`. Không thêm runtime state; restart-safe (derive từ JSONL). Thêm `'auto-loop'` vào union `TaskRun.triggeredBy`.

### 5. Bảng quyết định (sau gate run `completed`, đặt trong `executeRun` cạnh nhánh `outcome === 'failed'`)

| verdict | `auto` | còn lượt | hành động |
|---|---|---|---|
| `pass` | — | — | phase → `completed` (hoặc `waiting_approval` nếu `node.approval`) |
| `fail` | true | còn | auto loop-back: rerun `onFailTarget`, gate → `pending` |
| `fail` | true | hết | phase → `waiting_approval` (escalate) |
| `fail` | false | — | phase → `waiting_approval` |
| (none) | — | — | phase → `waiting_approval` |

`failed` (lỗi run) giữ nguyên hành vi cũ — không bị auto-loop nuốt.

Khi escalate (`waiting_approval`), người dùng giải quyết bằng **Approve** hoặc **Rerun thủ công kèm instruction** (tự đưa solution) — KHÔNG thêm chế độ tự chạy thêm vòng/reset đếm; escalate đúng là checkpoint để người ra phán quyết.

### 6. Validate lúc upsert workflow

`gate.onFailTarget` phải là ancestor (`gate ∈ downstreamOf(onFailTarget)`); `maxIterations ≥ 1` clamp ≤ 10. Sai → reject (fail fast). Giữ invariant acyclic.

## Phương án đã cân nhắc

- **Option A (CHỌN) — gate node + verdict + loop-back ở engine.** Tái dùng `rerunPhase`/cascade/approval; deterministic; mỗi vòng hiện rõ thành phase/run riêng (trace + version giữ nguyên); restart-safe (đếm vòng từ event); có escalate sang người. Thêm tối thiểu: 1 field node + 1 field run + 1 giá trị `triggeredBy`.
- **Option B — orchestrator meta-agent** (kiểu skill `g-dev-flow`) dùng subagent `Task` tool ([ADR 0030](0030-subagent-task-tool.md)) điều phối dev/QA/review trong **một turn**. Từ chối làm cơ chế chính: gói vòng lặp trong một run khổng lồ → mất per-phase trace/version/approval, đốt context, **không restart-safe**, phi tất định, khó quan sát/can thiệp. *Vẫn hữu ích bổ trợ* cho điều phối ad-hoc trong **Session** (không phải Task bền) — giữ như công cụ song song, không thay Option A.
- **Option C — cạnh ngược thật (DAG có chu trình).** Từ chối: phá `computeRunnable` join semantics, cycle-detection, BFS invalidation; phải tái kiến trúc scheduler; chặn vòng vô hạn khó hơn.
- **Option D — overload `failed` cho verdict QA.** Từ chối: trộn lỗi run với phán chất lượng; QA tìm bug là run *thành công*; `failed` không mang được findings; không escalate sạch.

## Hệ quả

**Tích cực:**
- Đúng nhu cầu: QA/review fail → dev tự sửa → tự chạy lại, tới khi pass hoặc chạm trần.
- Thêm rất ít khái niệm; tái dùng cascade/rerun/approval/versioning sẵn có; DAG vẫn acyclic.
- Deterministic, quan sát được từng vòng; restart-safe; luôn có escalate cho guild master.

**Tiêu cực / Trade-off:**
- Verdict phụ thuộc model phát đúng block quy ước (L1) → parse defensive + escalate khi thiếu; **phải cập nhật skill** qa/review/infosec.
- Auto-loop tốn token → bắt buộc trần per-gate + trần tuyệt đối (=10); cần infosec review budget.
- Chỉ loop-back **1 target**, chưa phải conditional routing tổng quát (vẫn để sau MVP).
- Restart giữa vòng: theo policy boot hiện tại task suspend `paused`, người Resume tiếp (chấp nhận).

**Việc cần làm tiếp:**
- Sidecar: `NodeGate` + `verdict`/`triggeredBy:'auto-loop'` vào [shared.ts](../../apps/desktop/sidecar/src/types/shared.ts); parse verdict trong [node-runner.ts](../../apps/desktop/sidecar/src/tasks/node-runner.ts); nhánh verdict trong [engine.ts](../../apps/desktop/sidecar/src/tasks/engine.ts) `executeRun`; validate ancestor lúc `workflows.upsert`.
- UI: gate config trong Workflow Builder (AppSelect ancestor + maxIterations + auto); verdict badge + loop counter + auto-loop badge trong Task detail; mirror types `ui/types`.
- Verdict instruction: **inject engine-side** trong `node-runner` khi `node.gate` (không sửa từng skill — skill runtime là user-data ở `~/.awog/skills`).
- i18n en/vi; typecheck cả sidecar + ui-next; infosec review (loop budget); cập nhật [task-execution-engine.md](../features/task-execution-engine.md) câu hỏi mở "Retry".

## Tham chiếu

- [ADR 0024](0024-task-execution-engine-ipc-contract.md) — Task Execution Engine (scheduler, rerun cascade, approval park).
- [ADR 0030](0030-subagent-task-tool.md) — subagent `Task` tool (nền cho Option B bổ trợ).
- Spec: [docs/features/orchestration-feedback-loop.md](../features/orchestration-feedback-loop.md).
- [docs/features/human-approval.md](../features/human-approval.md), [docs/features/workflow-builder.md](../features/workflow-builder.md).
