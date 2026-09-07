# Cô lập node Task song song + ngân sách cho Task

> Quyết định kiến trúc: [ADR 0081](../decisions/0081-task-node-worktree-isolation.md). Nền tảng: [Task Execution Engine](task-execution-engine.md) ([ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md)).

Tài liệu này mô tả **hành vi đã ship** ở tầng sidecar. Chưa có UI cho phần cấu hình — mọi thứ chỉnh bằng biến môi trường hoặc mặc định.

## 1. Vấn đề

Scheduler chạy tới 4 node cùng lúc nhưng trước đây mọi node dùng **chung một cây làm việc** (`project.path`):

- hai agent song song sửa cùng file → ghi đè nhau, không ai chặn;
- auto-commit per-phase (`git add -A`) của node này **quét cả file dở dang** của node kia → commit lẫn lộn, node còn lại thì "no changes".

Song song đó, node Task chạy **không có trần** chi phí / tool call / thời gian, trong khi Session thì có.

## 2. Cây làm việc của một node

| Tình huống | Node chạy ở đâu |
|---|---|
| Node **đầu tiên** đang chạy của project | Cây gốc `project.path` — **y hệt trước đây** |
| Node đang chạy **thứ 2, 3, 4** | Worktree riêng `~/.awog/tasks/<taskId>/worktrees/<nodeId>-vN`, branch `awog/task/<taskId>/<nodeId>-vN`, checkout tại `HEAD` |

Nhờ vậy DAG tuần tự (đại đa số) **không đổi hành vi**: giữ nguyên `node_modules`, `.env`, thư mục build; không tốn thêm một lần checkout.

Cùng một cwd đi vào **cả** agent lẫn auto-commit, nên commit của một node luôn nằm đúng cây mà node đó đã sửa.

### Gộp kết quả về nhánh chính

Ở mỗi **điểm ráo** (không node nào đang chạy), **trước khi** phát đợt node kế tiếp, engine merge mọi branch node của task về nhánh hiện tại của repo:

```
git merge --no-edit -m "Merge task node branch <branch>" <branch>
git branch -d <branch>          # chỉ khi merge thành công
```

Chạy trước lúc dispatch nên node hạ nguồn luôn thấy đủ kết quả của các node song song thượng nguồn.

**Merge chỉ hạ cánh xuống nhánh đã neo.** `git merge` luôn merge vào **HEAD hiện tại**, nên nếu người dùng `git checkout` sang nhánh khác giữa lúc task chạy thì commit của agent sẽ rơi nhầm nhánh. Vì vậy nhánh đang checkout **lúc cấp worktree đầu tiên** được ghi xuống `~/.awog/tasks/<taskId>/worktree-base`; ở điểm ráo, HEAD lệch nhánh đó (kể cả detached) ⇒ **không merge branch nào**, phát `task.worktree` `action: 'conflict'` với `detail` nêu đủ *nhánh hiện tại*, *nhánh đã neo* và danh sách branch, rồi task về `paused`. AWOG **không** checkout hộ người dùng. Checkout lại đúng nhánh rồi Resume là merge tiếp bình thường. Neo được xoá khi mọi branch của task đã merge xong, nên đợt cô lập sau neo lại đúng nhánh lúc đó.

Danh sách branch chờ merge **derive từ git** (`for-each-ref refs/heads/awog/task/<taskId>/`), không giữ trong RAM ⇒ restart giữa chừng không làm mất dấu công việc đã commit.

### Khi hai node sửa cùng chỗ (conflict)

1. `git merge --abort` — cây của người dùng **sạch**, không kẹt merge dở.
2. Branch của node **được giữ nguyên** (đó là commit thật của agent).
3. Ghi event `task.worktree` với `action: 'conflict'` + `detail` (stderr của git, **đã qua `sanitizeStderr`** như đường RPC của Git Manager — token trong URL remote và path tuyệt đối bị cắt — rồi giới hạn 500 ký tự) vào `events.log`, phát `task.worktree` lên UI.
4. **Task chuyển sang `paused`.** Người dùng merge tay rồi bấm Resume; lần integrate sau sẽ thấy "Already up to date" và dọn branch.

AWOG **không** tự giải quyết conflict: hai node song song sửa cùng một chỗ là vấn đề thiết kế DAG, đoán hộ chỉ tạo ra kết quả sai một cách âm thầm.

### Dọn dẹp

| Khi nào | Làm gì |
|---|---|
| Node xong (kể cả fail) | **Hỏi `git status --porcelain` trước** (xem "Không xoá mù" bên dưới). Cây sạch ⇒ xoá checkout (`git worktree remove --force` + `worktree prune`, rồi `rm -rf` cho chắc). **Branch giữ lại** để merge |
| Merge thành công | `git branch -d` |
| Sidecar khởi động lại | `sweepOrphanWorktrees()` chạy đầu `resumeOnBoot()`: **từng** checkout còn sót dưới `~/.awog/tasks/*/worktrees/` đi qua đúng lưới an toàn của release, rồi mới xoá + `git worktree prune`. **Branch giữ lại**, sẽ merge ở điểm ráo đầu tiên sau khi task resume |

#### Không xoá mù (lưới an toàn chống mất dữ liệu)

`canCommit` chỉ nói auto-commit **được bật**, không nói commit **đã xảy ra**: node fail giữa chừng, hook `pre-commit` chặn, `add` trượt… đều để lại một cây còn việc mà không có commit nào. Xoá checkout lúc đó là mất trắng.

Nên trước **mọi** lần bỏ checkout (release cuối node-run **và** sweep lúc boot):

| `git status --porcelain` | Xử lý | Kết quả trả về |
|---|---|---|
| rỗng | Xoá checkout như thường | `clean` |
| còn thay đổi, commit WIP được | `git add -A` + `git commit --no-verify --no-gpg-sign -m "WIP: rescued uncommitted work from task node branch <branch>"` **trên chính branch của node**, rồi mới xoá checkout. Commit này được merge về như mọi commit khác | `rescued` |
| còn thay đổi, commit WIP **cũng hỏng** | **Không xoá gì cả** — checkout còn nguyên trên đĩa. Node-runner phát `task.worktree` `action: 'conflict'` kèm `detail` + đường dẫn để người dùng vào lấy; lượt sweep sau thử lại | `retained` |

Commit rescue cố tình bỏ qua hook và ký GPG: nó là lưới an toàn, không phải commit "đẹp" — để một hook chặn nó thì lại quay về đúng chỗ mất dữ liệu.

### Degrade an toàn

Không cô lập được thì **quay về hành vi cũ** (dùng chung `project.path`), log `warn` kèm `reason`, task vẫn chạy:

| `reason` | Nghĩa là |
|---|---|
| `per-phase-auto-commit-off` | Task tắt auto-commit per-phase hoặc dùng scope `artifacts-only` ⇒ node không commit ⇒ worktree sẽ **mất dữ liệu** khi xoá checkout |
| `not-a-git-repo` | Project không nằm trong repo git |
| `git-older-than-2.20` | Git quá cũ (cùng ngưỡng Git Manager) |
| `detached-head` | Repo đang ở HEAD detached ⇒ không có nhánh nào để neo merge |
| thông điệp lỗi của git | `worktree add` thất bại (hết đĩa, `.git` chỉ đọc…) |

> **Lưu ý vận hành:** worktree là checkout **sạch** — không có file không-track (`node_modules`, `.env`, cache build). Node cần build/test mà chạy song song với node khác sẽ phải tự cài dependency.

## 3. Ngân sách cho một lần chạy task

Áp ở cấp **task** (tổng mọi node), không phải per-turn.

| Chiều | Mặc định | Env ghi đè | Bền qua restart? |
|---|---|---|---|
| Chi phí USD | **20** | `AWOG_TASK_MAX_USD` | ✅ (cộng từ `run.usage` trong `events.log`) |
| Số tool call | **1500** | `AWOG_TASK_MAX_TOOL_CALLS` | ❌ (đo "đợt chạy này") |
| Wallclock | **4 giờ** | `AWOG_TASK_MAX_WALLCLOCK_MS` | ❌ (tính từ start/resume) |

Đặt `0` (hoặc số âm) để **tắt** một chiều. Env đọc một lần cho cả tiến trình — đổi thì restart sidecar. Chi phí tính bằng bảng giá `pricing/catalog.ts` (default → remote → override); **model không có giá thì đóng góp 0 USD**, lúc đó hai chiều còn lại là lưới an toàn.

### Chạm trần thì sao

1. Phát hiện ở hai chỗ: trước khi scheduler phát node mới, và giữa lượt tại mỗi tool call.
2. Giữa lượt ⇒ abort lượt đang chạy, phase quay về **`pending`** (không phải `failed`) ⇒ resume chạy lại node sạch sẽ, downstream **không** bị đánh dấu hỏng lây.
3. Ghi **một** event `task.budget` vào `events.log` + phát `task.budget.exceeded`.
4. Task treo ở **`paused`**. Nới trần (env) → restart sidecar → Resume. Resume mở lại cửa sổ đo (đồng hồ + tool call về 0); **chi phí USD không reset** vì nó derive từ log.

## 4. Event mới trong `events.log`

Cả hai đều **thuần thông tin** — fold không đổi snapshot, chúng chỉ trả lời "vì sao task này dừng" sau khi restart.

```jsonc
{ "type": "task.budget", "at": "…", "dimension": "cost|toolCalls|wallclock",
  "limit": 20, "observed": 21.4, "message": "Task budget exceeded: …" }

{ "type": "task.worktree", "at": "…", "action": "allocated|merged|conflict",
  "branch": "awog/task/<taskId>/<nodeId>-vN",
  "nodeId": "…", "version": 2,   // 'allocated', và 'conflict' phát từ node-runner
  "detail": "…" }                // chỉ có ở 'conflict' (đã sanitize)
```

`action: 'conflict'` có hai nguồn: **integrate** (merge đụng nhau, hoặc HEAD lệch nhánh đã neo) và **release** (checkout còn việc chưa cứu được — `detail` mang cả đường dẫn checkout). Cả hai đều là "cần người can thiệp tay".

Kênh sidecar-event tương ứng: `task.budget.exceeded`, `task.worktree`. UI chưa tiêu thụ (bỏ qua event lạ) — xem phần "việc cần làm tiếp" của ADR.

## 5. File liên quan

| Path | Vai trò |
|---|---|
| [`tasks/worktree.ts`](../../apps/desktop/sidecar/src/tasks/worktree.ts) | Cấp/nhả worktree, merge branch về, dọn mồ côi |
| [`tasks/budget.ts`](../../apps/desktop/sidecar/src/tasks/budget.ts) | Trần cost/tool-call/wallclock cấp task |
| [`tasks/node-runner.ts`](../../apps/desktop/sidecar/src/tasks/node-runner.ts) | Lấy cwd từ worktree, đếm tool call, nhả workspace ở `finally` |
| [`tasks/engine.ts`](../../apps/desktop/sidecar/src/tasks/engine.ts) | Merge ở điểm ráo, pause khi chạm trần/conflict, sweep lúc boot |
| [`git/runner.ts`](../../apps/desktop/sidecar/src/git/runner.ts) | `gitVersion()` / `gitAtLeast()` dùng chung |
| [`tasks/__tests__/worktree.test.ts`](../../apps/desktop/sidecar/src/tasks/__tests__/worktree.test.ts) | Test vòng đời (chờ vitest được wire vào sidecar) |

## 6. Chưa làm

- UI cho trần ngân sách + hiển thị lý do `paused` (budget / conflict) và tên branch cần merge tay.
- Trần per-task lưu trên `Task` (hiện chỉ có mặc định + env).
- Recovery tự động cho branch còn sót sau khi task đã `completed` (hiện chỉ log).
- UI cho checkout `retained` (cây giữ lại vì không cứu được): hiện chỉ có event + log, chưa có nút "mở thư mục".
