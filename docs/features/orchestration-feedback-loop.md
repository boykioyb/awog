# Feature: Orchestration Feedback Loop (Gate node + Verdict)

**Trạng thái:** Implemented (sidecar + ui-next) — contract tại [ADR 0056](../decisions/0056-orchestration-feedback-loop.md). Cần rebuild sidecar dist + restart app để chạy thử.

## Vấn đề

Task Execution Engine ([ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md)) chạy workflow như một **DAG tuyến tính/song song**. Khi node QA hoặc Reviewer phát hiện lỗi, engine **không** tự quay về node Developer để sửa rồi chạy lại — người dùng phải bấm **Rerun from here** thủ công. Lý do gốc:

1. **Edge không có điều kiện** (`WorkflowEdge = { from, to }`), DAG bắt buộc acyclic → không vẽ được vòng QA → dev.
2. **Outcome của node chỉ có `completed | waiting_approval | failed`**, trong đó `failed` nghĩa là *run lỗi kỹ thuật* (SDK throw / abort), KHÔNG phải *QA phán lỗi*. Một node QA tìm ra 5 bug vẫn là một run **thành công**.
3. **Không có "verdict" máy đọc được** → scheduler không có dữ liệu để quyết định lặp.

Feature này thêm khái niệm **Gate node** (checkpoint chất lượng có verdict pass/fail) + **vòng lặp tự động quay về** node upstream để sửa, có **trần lặp** và **escalate sang người** khi hết lượt.

## User Stories

- Là guild master, tôi muốn khi QA phán **fail**, engine tự đưa lỗi về Developer sửa rồi tự chạy lại QA, lặp tới khi pass hoặc hết số vòng — không phải ngồi bấm Rerun từng lần.
- Là guild master, tôi muốn đặt **trần số vòng** để task không cháy token vô hạn; hết vòng mà vẫn fail thì task dừng lại **chờ tôi duyệt**.
- Là guild master, tôi muốn vẫn thấy đầy đủ lịch sử v1/v2/v3 của mỗi phase và verdict từng lần, để biết vòng lặp đã sửa được gì.
- Là người dùng thận trọng, tôi muốn tắt auto và chỉ để gate **báo verdict** rồi tôi tự quyết Rerun — giữ nguyên hành vi hiện tại.

## Khái niệm cốt lõi

### 1. Verdict — tín hiệu pass/fail máy đọc được

Tách khỏi `RunStatus`. Một gate run **vẫn `completed`** (nó chạy xong, làm đúng việc) nhưng mang thêm `verdict: 'pass' | 'fail'`.

- Agent của gate node được skill yêu cầu kết thúc output bằng **một fenced block** quy ước:

  ````
  ```verdict
  status: fail
  summary: 3 lỗi — null-deref ở auth.ts:42, thiếu test cho edge case, lint fail
  ```
  ````

- `node-runner` parse **block `verdict` cuối cùng** trong output (regex, defensive — output là trust **L1**).
- **Không parse được / thiếu block** trên một gate → KHÔNG đoán → **escalate sang người** (`waiting_approval`), không bao giờ auto-loop trên parse lỗi (tránh đốt token).

### 2. Gate node — checkpoint có chỉ thị quay về

Bất kỳ `WorkflowNode` nào cũng có thể là gate bằng field tùy chọn `gate`:

```ts
interface NodeGate {
  // nodeId để quay về khi verdict = fail. BẮT BUỘC là ancestor (tổ tiên) của
  // gate trong DAG — gate phải nằm trong downstreamOf(onFailTarget). Giữ edges
  // acyclic: vòng lặp là CHỈ THỊ trên node, KHÔNG phải cạnh chu trình.
  onFailTarget: string
  // Trần số vòng tự động cho gate này. Hết vòng vẫn fail → escalate sang người.
  // Engine ép thêm trần tuyệt đối MAX_GATE_ITERATIONS_CEILING (=10) bất kể config.
  maxIterations: number
  // true = engine tự lặp; false = chỉ báo verdict, người tự Rerun (như hôm nay).
  auto: boolean
}
```

Thêm `gate?: NodeGate` vào `WorkflowNode` (cả `shared.ts` sidecar lẫn `ui/types`).

### 3. Auto loop-back — tái dùng cascade của rerun

Khi gate verdict = fail và còn lượt, engine **tái dùng nguyên cơ chế `rerunPhase`**: rerun `onFailTarget` với output của gate (bug report) làm `instruction`, đánh dấu `triggeredBy: 'auto-loop'`. `downstreamOf(onFailTarget)` invalidate toàn bộ đường từ dev xuống gate (run cũ → `superseded`, phase → `pending`), scheduler chạy lại lần lượt → gate chạy lại → parse verdict lần nữa.

**Đếm vòng = event-sourced, restart-safe:** số vòng đã chạy = số run trên `onFailTarget` có `triggeredBy === 'auto-loop'`. Không thêm state runtime mới, sống sót qua restart.

## Bảng quyết định của engine (sau khi một gate run `completed`)

| verdict | `auto` | còn lượt? | Kết quả |
|---|---|---|---|
| `pass` | — | — | phase → `completed` (hoặc `waiting_approval` nếu `node.approval`) → downstream chạy tiếp |
| `fail` | `true` | còn | **auto loop-back**: rerun `onFailTarget` (instruction = findings); gate bị invalidate → `pending`, chạy lại sau khi path re-flow |
| `fail` | `true` | hết (chạm trần) | phase → `waiting_approval` — **escalate**: người Approve (chấp nhận) / **Rerun thủ công kèm instruction** (đưa solution) / sửa workflow |
| `fail` | `false` | — | phase → `waiting_approval` — người xem verdict rồi tự quyết |
| (không parse được) | — | — | phase → `waiting_approval` — không đoán, escalate |

`failed` (run lỗi kỹ thuật) **không đổi**: vẫn lan downstream `failed` rồi task dừng. Auto-loop CHỈ áp cho `verdict: 'fail'`, không cho lỗi run.

## Ví dụ luồng

```
Workflow: DEV → QA(gate: onFailTarget=DEV, maxIterations=3, auto=true) → PR

DEV v1 (completed) → QA v1 → verdict: fail (2 bug)
  ↓ auto loop-back (vòng 1/3): rerun DEV, instruction = bug report của QA v1
DEV v2 (completed) → QA v2 → verdict: fail (1 bug)
  ↓ auto loop-back (vòng 2/3)
DEV v3 (completed) → QA v3 → verdict: pass
  ↓
QA completed → PR chạy tiếp
```

Nếu QA v4 vẫn fail (chạm trần 3) → QA → `waiting_approval`, task suspend, tray notification "QA chưa pass sau 3 vòng — cần bạn xem".

### Giải quyết khi escalate (đã chốt)

Chạm trần là lúc **con người phải quyết định và đưa solution** — engine không tự suy diễn thêm. Người dùng dùng đúng 3 nút sẵn có ở phase (không thêm UX mới):

- **Approve** — chấp nhận verdict fail, cho qua, downstream chạy tiếp (bug còn lại không đáng chặn).
- **Rerun thủ công kèm instruction** — người gõ solution/chỉ dẫn cụ thể cho dev rồi chạy lại; KHÔNG giới hạn `maxIterations` vì giờ là người chủ động bấm.
- **Discussion** — hỏi gate để hiểu rõ trước khi quyết, không invalidate gì.

**KHÔNG** thêm chế độ "sửa instruction rồi tự chạy thêm vòng (reset đếm)": tại escalate, vòng tự động đã chứng minh không tự giải được → đúng vai trò người ra phán quyết, Rerun thủ công là đủ.

## Ràng buộc & validate (workflow upsert)

- `gate.onFailTarget` phải tồn tại và là **ancestor** của gate: `downstreamOf(onFailTarget)` chứa gate. Sai → reject (fail fast), giữ DAG acyclic.
- `gate.maxIterations` ≥ 1; engine clamp xuống `MAX_GATE_ITERATIONS_CEILING` (=10) — chặn cháy token (security: "loop gọi model → budget per task").
- Một node có thể vừa là gate vừa có `approval`: pass + approval → `waiting_approval` (duyệt như thường); fail thì theo bảng trên (loop / escalate), bỏ qua duyệt cho tới khi pass hoặc chạm trần.

## UI

### Workflow Builder
- Trên node inspector: section **Gate** — toggle bật; khi bật hiện: dropdown `onFailTarget` (chỉ liệt kê **ancestor** của node, dùng `AppSelect`), input `maxIterations`, toggle `auto`.
- Node là gate hiển thị icon/badge phân biệt trên canvas.

### Task detail (pipeline timeline)
- Gate phase hiện **verdict badge**: `pass` (accent xanh) / `fail` (danger) — màu qua `useTheme()`, không hardcode.
- Bộ đếm vòng: `Loop 2/3` (badge `text-[12px]` fixed, font-mono, theo [nuxt-vue.md](../../.claude/rules/nuxt-vue.md) UI patterns).
- Run sinh bởi loop hiện badge `auto-loop` (mẫu badge `rerun` sẵn có).
- Khi escalate → `waiting_approval` kèm verdict fail + findings để người đọc trước khi quyết.

## Verdict instruction = engine-inject, KHÔNG sửa từng skill

Gate cần agent **phát ra block `verdict`**. Thay vì sửa body từng skill (skill runtime nằm ở `~/.awog/skills`, là user-data, không nằm trong repo → mong manh), `node-runner` **tự chèn** chỉ dẫn verdict vào prompt khi `node.gate` được set. Nhờ vậy **bất kỳ skill nào** gắn lên gate đều hoạt động, không cần biên tập skill. Chỉ dẫn yêu cầu: kết thúc bằng block ```verdict``` với `status: pass|fail` và `summary` một dòng; `fail` nếu còn bất kỳ tiêu chí bắt buộc chưa đạt.

## Acceptance Criteria

- **AC1** — Gate `auto=true`, verdict fail, còn lượt → engine tự rerun `onFailTarget` với findings làm instruction; KHÔNG cần người bấm.
- **AC2** — Sau auto loop-back, toàn bộ path từ `onFailTarget` xuống gate re-run đúng thứ tự DAG; run cũ thành `superseded`, lịch sử version giữ nguyên.
- **AC3** — Chạm `maxIterations` mà vẫn fail → gate → `waiting_approval`, task suspend, có notification; KHÔNG lặp tiếp.
- **AC4** — Gate `auto=false`, verdict fail → `waiting_approval` ngay (hành vi như Rerun thủ công hôm nay); không tự lặp.
- **AC5** — Output gate không có block `verdict` hợp lệ → `waiting_approval` (không auto pass, không auto loop).
- **AC6** — `failed` (lỗi run thật) trong vòng lặp vẫn lan downstream `failed` + task dừng — không bị auto-loop nuốt.
- **AC7** — Đếm vòng đúng sau restart (derive từ run `triggeredBy='auto-loop'`); resume không reset bộ đếm.
- **AC8** — Workflow có `onFailTarget` không phải ancestor bị reject lúc save với lỗi rõ ràng.

## Out of Scope (v1)

- **Conditional routing tổng quát** (if/else rẽ sang downstream khác nhau) — vẫn để sau MVP, xem [workflow-builder.md](workflow-builder.md) câu hỏi mở. Feature này chỉ làm **loop-back 1 target**.
- **Reject branch** (nhánh riêng khi fail) — dùng loop-back + escalate thay thế.
- Nhiều `onFailTarget` cho một gate; nhiều gate trỏ chung target (v1 giả định 1-1).
- Orchestrator meta-agent (kiểu `g-dev-flow` gói trong 1 turn) — xem [ADR 0056](../decisions/0056-orchestration-feedback-loop.md) phương án B (bổ trợ, không thay thế).

## Phụ thuộc

- [task-execution-engine](task-execution-engine.md) — phase/run/scheduler, `rerunPhase`, cascade BFS.
- [human-approval](human-approval.md) — escalate dùng lại `waiting_approval` + Approve/Rerun.
- [workflow-builder](workflow-builder.md) — cấu hình gate per node.
- [agent-trace](agent-trace.md) — hiển thị verdict/iteration.

## Đã chốt

- **Instruction auto-loop = toàn bộ output gate** (bug report đầy đủ) làm `instruction` cho `onFailTarget`, có cap độ dài như `<linked_task>` (8k). Lý do: dev cần đủ ngữ cảnh để sửa đúng (2026-06-27).
- **Giải quyết khi escalate = Rerun thủ công** (kèm instruction do người đưa) hoặc Approve — KHÔNG thêm chế độ tự chạy thêm vòng/reset đếm. Lý do: escalate đúng là lúc cần người quyết định + đưa solution (2026-06-27).
