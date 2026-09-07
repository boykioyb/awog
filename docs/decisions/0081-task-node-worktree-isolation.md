# 0081 — Cô lập working tree cho node Task song song + ngân sách cho Task

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-06
- **Người quyết định:** developer (WP6), theo [ADR 0024](0024-task-execution-engine-ipc-contract.md)

## Bối cảnh

### A. Bốn node song song ghi đè nhau

Task Execution Engine ([ADR 0024](0024-task-execution-engine-ipc-contract.md)) chạy tới `CONCURRENCY_CAP = 4` node cùng lúc (`tasks/engine.ts`), nhưng mọi node đều lấy **cùng một** cwd:

```ts
const cwd = project.path            // tasks/node-runner.ts
…
await autoCommitPhase({ workspaceRoot: cwd, … })
```

Hệ quả là hai lỗi thật, không phải thiếu tính năng:

1. **Ghi đè lẫn nhau.** Hai agent chạy song song cùng sửa một file trong một cây làm việc duy nhất. Node B đọc file khi node A mới ghi được một nửa; node A ghi đè thay đổi của node B. Không có gì chặn.
2. **Auto-commit lẫn lộn.** `autoCommitPhase` với scope `workspace` chạy `git add -A` — nó quét **cả** file dở dang của node đang chạy song song. Commit của node A mang theo công việc của node B; đến lượt node B commit thì `git` báo "no changes" và phase đó mất dấu vết trong lịch sử. Mutex per-workspace hiện có ([`git/mutex.ts`](../../apps/desktop/sidecar/src/git/mutex.ts)) chỉ chống đụng `.git/index.lock`, hoàn toàn không chống được chuyện này.

### B. Task chạy không có ngân sách

`Session` có `SessionBudget { limitUsd, hardLimitUsd, maxToolCalls, maxWallclockMs }` và được enforce thật (`methods/sessions.send-message.ts` chặn trước khi gọi model, `runtime/permission.ts:withTurnBudget` chặn tool call). Grep `budget` trong `tasks/node-runner.ts` cho **0 kết quả**: node Task chạy không cap gì. Trong khi chính comment ở `types/shared.ts:368` tự nhận là *"Closes the budget per task invariant"* — code không khớp lời hứa, và một DAG hỏng có thể chạy suốt đêm.

## Quyết định

### A. "First-claim shared, phần còn lại vào worktree"

Cây làm việc của một node-run do [`tasks/worktree.ts`](../../apps/desktop/sidecar/src/tasks/worktree.ts) cấp, không còn hard-code `project.path`:

- Node **đầu tiên** đang chạy của một project giữ **cây gốc** (`project.path`). Claim đặt **đồng bộ** (không `await` trước khi set) nên hai node dispatch trong cùng một tick không thể cùng nhận.
- Node đang chạy **thứ hai trở đi** được cấp `git worktree add -b awog/task/<taskId>/<nodeId>-vN <dir> HEAD`, với `<dir>` nằm dưới `~/.awog/tasks/<taskId>/worktrees/` — **sidecar tự chọn, không nhận path từ UI** (invariant #2/#3). Agent, tool filesystem, và auto-commit của node đó đều trỏ vào cwd này.
- **Gộp kết quả:** ở mỗi **điểm ráo** (không node nào đang chạy), scheduler gọi `integrateTaskBranches()` **trước khi phát đợt node kế tiếp** → `git merge` từng branch node về nhánh hiện tại của repo, merge xong thì `git branch -d`. Nhờ chạy trước khi dispatch, node hạ nguồn luôn thấy đủ kết quả của các node song song thượng nguồn.
- **Conflict** (hai node sửa cùng chỗ): `git merge --abort` → cây của người dùng sạch, **branch được giữ nguyên**, ghi event `task.worktree` action `conflict`, và **task chuyển sang `paused`**. AWOG không đoán hộ; người dùng merge tay rồi Resume (lần integrate sau sẽ thấy "Already up to date" và xoá branch).
- **Danh sách branch chờ merge derive từ git** (`for-each-ref refs/heads/awog/task/<taskId>/`), không giữ trong bộ nhớ ⇒ restart không mất dấu.
- **Dọn mồ côi:** `sweepOrphanWorktrees()` chạy đầu `resumeOnBoot()` — xoá mọi checkout còn sót dưới `~/.awog/tasks/*/worktrees/` rồi `git worktree prune`. **Branch không bị xoá** (đó là commit của agent) và sẽ được merge ở điểm ráo đầu tiên sau khi task resume.

**Degrade an toàn** — mọi trường hợp dưới đây quay về hành vi cũ (dùng chung `project.path`) kèm log `warn` nêu `reason`, task vẫn chạy bình thường:

| reason | Vì sao |
|---|---|
| `per-phase-auto-commit-off` | `autoCommitPerPhase === false` hoặc scope `artifacts-only` ⇒ node không commit ⇒ worktree là **bẫy mất dữ liệu** (thay đổi chưa commit biến mất cùng checkout) và cũng không có gì để merge về |
| `not-a-git-repo` | Không có git thì không có cơ chế cô lập |
| `git-older-than-2.20` | Đúng ngưỡng Git Manager đang yêu cầu ([ADR 0017](0017-git-manager-ipc-contract.md)) — không thêm ngưỡng thứ hai để giải thích |
| lỗi `worktree add` | Hết đĩa, `.git` chỉ đọc, branch trùng… |

### B. Ngân sách cấp Task

[`tasks/budget.ts`](../../apps/desktop/sidecar/src/tasks/budget.ts) áp trần cho **cả task** (tổng mọi node), không phải per-turn:

| Chiều | Mặc định | Nguồn số liệu |
|---|---|---|
| `maxCostUsd` | **20 USD** | Cộng `run.usage` của **mọi** run (kể cả `superseded`) × bảng giá `pricing/catalog.ts` — event-sourced ⇒ sống sót restart |
| `maxToolCalls` | **1500** | Đếm trong bộ nhớ, mọi node dồn về một bộ đếm |
| `maxWallclockMs` | **4 giờ** | Từ lúc start/resume, trong bộ nhớ |

Ghi đè bằng biến môi trường của sidecar: `AWOG_TASK_MAX_USD`, `AWOG_TASK_MAX_TOOL_CALLS`, `AWOG_TASK_MAX_WALLCLOCK_MS` (0 hoặc âm = tắt chiều đó). Chưa làm UI — xem [spec](../features/task-node-isolation.md).

**Dừng có trật tự, không kill cụt:**

1. Phát hiện trước khi phát node mới (scheduler) hoặc giữa lượt (`onToolUse` của node-runner).
2. Giữa lượt ⇒ `abortController.abort()`, và phase quay về **`pending`** (đúng đường resume-sau-crash mà `resumeOnBoot` đã dùng) chứ không phải `failed` ⇒ resume chạy lại node sạch sẽ, downstream **không** bị đánh dấu failed.
3. Ghi **một** event `task.budget` vào `events.log` (cờ `claimBudgetReport` chống ghi hai lần từ hai điểm phát hiện) + phát `task.budget.exceeded` lên UI.
4. Task treo ở **`paused`**. Resume mở lại cửa sổ đo (đồng hồ + tool call về 0; **chi phí USD thì không**, nó derive từ log) — nới trần rồi Resume là chạy tiếp được.

## Phương án đã cân nhắc

- **Worktree cho MỌI node (kể cả DAG tuần tự)** — từ chối. Worktree là checkout sạch: không có `node_modules/`, `.env`, thư mục build. Đa số task là DAG tuần tự, không hề có tranh chấp, mà lại phải trả giá "không build được / phải cài lại dependency". Quy tắc "node đầu tiên giữ cây gốc" giữ **nguyên trạng cho 95% trường hợp** và chỉ trả giá đúng ở chỗ có tranh chấp thật.
- **Chỉ mutex per-repo cho auto-commit** — từ chối. `git/auto-commit.ts` **đã** dùng `withWorkspaceLock`; nó chống được `index.lock` nhưng không chống được hai agent sửa chồng file, cũng không chống được `git add -A` quét file của node khác. Nó không giải quyết tranh chấp thật.
- **Serialize toàn bộ node ghi cùng repo (mutex quanh cả node-run)** — từ chối. Một task chỉ có một project ⇒ mọi node cùng repo ⇒ `CONCURRENCY_CAP` thành 1, xoá sổ scheduler song song của ADR 0024.
- **Merge ngay khi node xong (không đợi điểm ráo)** — từ chối. Lúc đó cây gốc có thể đang có node khác ghi dở; `git merge` vào một cây bẩn hoặc là bị git từ chối, hoặc đè lên công việc đang làm.
- **Cherry-pick thay merge** — từ chối. Không tránh được conflict (cùng bản chất) mà lại mất thông tin nhánh; `merge` fast-forward được khi nhánh chính chưa nhúc nhích.
- **Tự commit "wip" hộ khi user tắt auto-commit** — từ chối. Vi phạm ý định người dùng đã nói rõ. Trường hợp đó degrade về cây gốc.
- **Budget đọc từ `Session.budget`/thêm field vào `Task`** — hoãn. `types/shared.ts` do gói việc khác sở hữu trong đợt này; hằng số + env đủ để đóng invariant ngay, thêm field + UI là follow-up.

## Hệ quả

- **Tích cực**
  - Hết ghi đè giữa các node song song, và commit mỗi node chỉ chứa đúng việc của node đó.
  - DAG tuần tự **không đổi hành vi**, không mất `node_modules`, không tốn thêm một lần checkout.
  - Conflict giữa hai node song song trở nên **nhìn thấy được** (event + task pause) thay vì âm thầm hỏng dữ liệu.
  - Task có trần chi phí/tool call/thời gian — đóng đúng invariant mà `types/shared.ts` đã hứa và bảng "Sink nhạy cảm" trong [security.md](../../.claude/rules/security.md) yêu cầu ("Loop gọi model → Budget per task").
  - Rác không tích luỹ: checkout mồ côi bị dọn ở boot, branch chỉ xoá **sau khi** merge thành công.
- **Tiêu cực / Trade-off**
  - Node chạy trong worktree **không có file không-track** (`node_modules`, `.env`, cache build). Node cần build/test mà lại chạy song song với node khác sẽ phải tự cài đặt. Đây là cái giá không tránh được của một checkout sạch.
  - Mỗi điểm ráo tốn 2 lần spawn `git` (`rev-parse` + `for-each-ref`) kể cả khi task chưa từng dùng worktree.
  - `maxToolCalls` + `maxWallclockMs` reset khi restart sidecar (persist mỗi tool call sẽ làm phình `events.log`). Chỉ `maxCostUsd` là bền.
  - Model không có trong bảng giá ⇒ đóng góp 0 USD vào bộ đếm; lúc đó hai chiều còn lại là lưới an toàn.
  - Tắt auto-commit per-phase ⇒ **không** có cô lập (degrade) — vẫn đúng bằng hành vi hôm nay, không tệ hơn.
- **Việc cần làm tiếp**
  - UI: hiện lý do task `paused` (budget / worktree conflict) và tên branch cần merge tay; thêm ô chỉnh trần trong Settings → Tasks (event `task.budget.exceeded` + `task.worktree` đã phát sẵn).
  - `git.checkInstalled` (methods/) vẫn tự parse `git --version`; nên chuyển sang `gitVersion()` mới trong `git/runner.ts` để chỉ còn một chỗ.
  - Chạy `pnpm vitest` khi vitest được wire vào sidecar — [`tasks/__tests__/worktree.test.ts`](../../apps/desktop/sidecar/src/tasks/__tests__/worktree.test.ts) đã viết sẵn.
  - infosec re-audit: module này spawn `git` và tạo/xoá thư mục (dù toàn bộ path đều do sidecar tự sinh).

## Tham chiếu

- [ADR 0024 — Task Execution Engine IPC contract](0024-task-execution-engine-ipc-contract.md)
- [ADR 0017 — Git Manager IPC contract](0017-git-manager-ipc-contract.md) (spawn invariant, ngưỡng git 2.20)
- [ADR 0056 — Orchestration feedback loop](0056-orchestration-feedback-loop.md) (trần vòng lặp gate — cùng tinh thần "budget guard")
- [Spec: Cô lập node Task + ngân sách](../features/task-node-isolation.md)
- [.claude/rules/security.md](../../.claude/rules/security.md) — invariant #2, #3 và dòng "Loop gọi model → Budget per task"

---

## Đính chính (2026-09-07) — F8/F15 của lượt infosec

ADR này giữ nguyên trạng thái **Accepted**; phần dưới **bổ sung** hai lỗ mất dữ liệu mà bản gốc bỏ sót và một chỗ rò rỉ, do lượt audit infosec phát hiện. Ba quyết định dưới đây là **chuẩn hiện hành** cho [`tasks/worktree.ts`](../../apps/desktop/sidecar/src/tasks/worktree.ts).

### F8a — "auto-commit BẬT" không có nghĩa là "đã commit"

Bản gốc suy luận: `canCommit === true` ⇒ node sẽ commit ⇒ xoá checkout ở `finally` là an toàn. Sai. `canCommit` chỉ đọc **cấu hình**; commit thật có thể không bao giờ xảy ra — node fail giữa chừng, hook `pre-commit` chặn, `add` trượt vì `.gitattributes` lạ. Lúc đó `git worktree remove --force` + `rm -rf` xoá toàn bộ việc agent vừa làm, **không còn branch nào để merge** và không hồi lại được.

**Quyết định: (a) — tự commit WIP rồi giữ branch như thường**, thay vì (b) chỉ giữ checkout + báo UI.

Lý do chọn (a):

- **Mất việc hỏng nặng hơn thừa một commit.** Một commit `WIP: rescued…` là thứ người dùng `git reset --soft HEAD~1` được trong ba giây; một cây đã `rm -rf` thì không có đường về.
- **(a) không cần contract mới.** Việc được cứu nằm trên đúng branch của node, nên nó đi tiếp qua `integrateTaskBranches()` như mọi commit khác: người dùng thấy nó ở nhánh chính, đúng chỗ họ đang chờ kết quả. Chọn (b) thì việc nằm trong một checkout dưới `~/.awog`, phải có UI mới thì mới lấy ra được — tức là công việc "đã cứu" nhưng vẫn vô hình.
- **(b) tích rác không giới hạn.** Cây bẩn nào cũng ở lại đĩa, và lượt sweep sau lại phải quyết định lần nữa. (a) chỉ để lại checkout trong đúng trường hợp không cứu nổi.

Chi tiết đã ship:

- Trước **mọi** lần bỏ checkout — release cuối node-run **và** `sweepOrphanWorktrees()` lúc boot, vì sweep cũng là một đường xoá hàng loạt — chạy `git status --porcelain`. Rỗng ⇒ xoá như cũ.
- Còn thay đổi ⇒ `git add -A` + `git commit --no-verify --no-gpg-sign` trên branch của node. **Cố tình** bỏ qua hook và ký GPG: hook `pre-commit` chính là một trong các đường mất trắng ở trên; đây là lưới an toàn, không phải commit "đẹp".
- Cứu không được (đĩa đầy, `.git` chỉ đọc, thiếu identity) ⇒ **không xoá gì**, `releaseNodeWorkspace` trả `{ status: 'retained', path, detail }`, node-runner phát `task.worktree` `action: 'conflict'` để người dùng biết cây nằm ở đâu. Lượt sweep sau thử lại.
- Kiểu trả về đổi: `releaseNodeWorkspace()` giờ trả `ReleaseOutcome` (`clean` | `rescued` | `retained`) thay vì `void`.
- Degrade `per-phase-auto-commit-off` **giữ nguyên** — nó vẫn đúng lý do khác (không có commit thì không có gì để merge về), chỉ không còn là *lý do duy nhất* chống mất dữ liệu.

### F8b — merge rơi vào nhánh đang checkout, không phải nhánh đã ghi

`git merge` hạ cánh xuống **HEAD hiện tại**. Người dùng lỡ `git checkout main` giữa lúc task chạy ⇒ commit của agent đổ xuống `main`.

**Cách phát hiện:** nhánh đang checkout lúc cấp worktree **đầu tiên** của task được ghi xuống `~/.awog/tasks/<taskId>/worktree-base` (ghi **trước** khi branch node tồn tại ⇒ không bao giờ có branch chờ merge mà thiếu neo). Ở điểm ráo, `integrateTaskBranches()` so `git symbolic-ref --quiet --short HEAD` với neo đó:

- khớp ⇒ merge như cũ;
- lệch, hoặc HEAD detached (`symbolic-ref` trả rỗng) ⇒ **không merge branch nào**, trả một `IntegrationOutcome` `conflict` với `detail` nêu đủ *nhánh hiện tại*, *nhánh đã neo* và danh sách branch cần merge tay ⇒ engine pause task đúng đường conflict sẵn có. **AWOG không checkout hộ người dùng** — đó là cây làm việc của họ.

Neo được **xoá** khi mọi branch của task đã merge xong, nên lần resume sau (có thể trên nhánh khác) neo lại đúng nhánh lúc đó. Task bắt đầu **trước** bản vá (không có neo) giữ hành vi cũ + log `warn`.

Kèm theo: `acquireNodeWorkspace` thêm degrade `detached-head` — không có nhánh nào để neo thì không cô lập, quay về cây gốc (đúng bằng hành vi trước ADR 0081).

Không chọn "tự `git checkout` về nhánh đã neo rồi merge": cây làm việc lúc đó có thể đang bẩn, và im lặng kéo người dùng khỏi nhánh họ vừa chuyển sang là một bất ngờ tệ hơn cả việc dừng task.

### F15 — stderr thô lên UI

`mergeOne` đẩy `git stderr` cắt 500 ký tự thẳng vào `detail` của event `task.worktree`, không qua `sanitizeStderr` như đường RPC (`git/runner.ts`). Stderr của git mang được token nhúng trong URL remote và path tuyệt đối. Đã dùng chung đúng sanitizer đó cho cả `detail` của merge, của nhánh `catch`, và của `retained` ở F8a (sanitize **trước** khi cắt 500).

### Kiểm chứng

`src/tasks/__tests__/worktree.test.ts` mở rộng, chạy trên repo git **thật** trong thư mục tạm: node fail còn thay đổi chưa commit ⇒ việc lên branch (kể cả khi repo có hook `pre-commit` luôn fail); `.git/objects` chỉ đọc ⇒ `retained`, sweep **không** xoá, sửa xong thì lượt sweep sau cứu và dọn; HEAD đổi sang nhánh khác/detached ⇒ không merge, nhánh người dùng không nhúc nhích, branch còn nguyên, về đúng nhánh thì merge lại bình thường; `detail` của merge lỗi không còn path tuyệt đối.

---

## Đính chính (2026-09-07) — khoá theo **owner**, và ranh giới merge cho chat

ADR này giữ nguyên trạng thái **Accepted**; phần dưới **mở rộng** phạm vi module từ "node Task" sang "một lượt chạy agent bất kỳ", theo đúng đề xuất ở [ADR 0083 §c](0083-pi-subagent-parity.md) ("Việc cần làm tiếp" mục 1). Đây là **chuẩn hiện hành** cho [`tasks/worktree.ts`](../../apps/desktop/sidecar/src/tasks/worktree.ts).

### A. Khoá theo owner, không khoá theo task

Bản gốc khoá `taskId` ở **bốn** chỗ độc lập: thư mục checkout (`~/.awog/tasks/<taskId>/worktrees/`), neo nhánh (`.../worktree-base`), tiền tố branch (`awog/task/<taskId>/`) và **sweeper** (`sweepOrphanWorktrees()` quét `listTaskIds()`). Subagent trong một phiên chat ([ADR 0083](0083-pi-subagent-parity.md)) có **đúng** tranh chấp mà ADR này vá — hai agent song song sửa chung một cây — nhưng không có `taskId`.

Mượn `sessionId` làm `taskId` là đường **sai**, và ADR 0083 đã nêu đúng vì sao: nó đẻ thư mục task ma trong store Task, và để lại checkout mồ côi mà không sweeper nào quét.

**Quyết định:** một khoá duy nhất cho cả bốn chỗ.

```ts
WorkspaceOwner = { kind: 'task' | 'session'; id: string }
```

| `kind` | Thư mục owner | Tiền tố branch |
|---|---|---|
| `task` | `~/.awog/tasks/<taskId>/` | `awog/task/<taskId>/` |
| `session` | `~/.awog/session-worktrees/<sessionId>/` | `awog/session/<sessionId>/` |

Layout của `task` **không đổi một ký tự** ⇒ không cần migration, checkout/branch có sẵn trên đĩa vẫn được nhận diện. Owner `session` nằm **cạnh** `tasks/`, cố ý không nằm trong: một thư mục con ở đó sẽ bị `listTaskIds()` (và mọi thứ đọc store Task) nhìn thấy như một task.

**Sweeper quét cả hai loại.** `listOwners()` = `listTaskIds()` ∪ `readdir(~/.awog/session-worktrees)`. Bỏ sót một loại chính là đẻ lại lỗi mồ côi dưới một cái tên mới, nên đây là phần không được phép "làm sau". Sweeper cần repo root để `worktree prune`; với owner `session` không có `task.projectId` để tra ngược, nên acquire ghi thêm `<ownerDir>/worktree-repo`. Owner `task` tạo trước bản vá này chưa có file đó ⇒ fall back về project của task như cũ.

`acquireNodeWorkspace(args)` / `releaseNodeWorkspace(taskId, ws)` đổi thành `acquireWorkspace({ owner, slug, projectPath, policy })` / `releaseWorkspace(owner, ws)`; `NodeWorkspace` → `IsolatedWorkspace`. Cờ boolean `canCommit` thành một enum nói đúng ý:

| `policy` | Ai dùng | Hành vi |
|---|---|---|
| `first-claim` | Node Task có commit | Lượt in-flight đầu tiên của project giữ cây gốc, phần còn lại vào worktree (**hành vi cũ**) |
| `shared` | Node Task tắt auto-commit per-phase | Không bao giờ cô lập (`reason: isolation-not-requested`) |
| `always` | Subagent chat | Luôn cô lập — cây gốc là cwd của chính lượt cha, không có chuyện giành chỗ |

### B. Ranh giới sản phẩm — chat **chỉ cô lập, KHÔNG tự merge**

ADR 0083 §c dừng lại đúng chỗ: `integrateTaskBranches()` merge vào nhánh người dùng **đang checkout**, và làm việc đó từ một lượt chat nghĩa là AWOG tự tạo branch + commit + merge vào repo của họ mà không ai bật một công tắc nào.

**Quyết định: subagent chat được worktree + branch, KHÔNG bao giờ được merge.** Cây làm việc của người dùng không nhúc nhích một byte; tool result nêu tên branch, người dùng tự `git merge` khi muốn.

Ràng buộc này là **kiểu, không phải quy ước**: `integrateTaskBranches(taskId, projectPath)` cố ý **không** nhận `WorkspaceOwner` — nó tự dựng owner `task` bên trong. Không có cách nào gọi hàm merge cho một owner `session`. Một quy ước ("nhớ đừng gọi cho session") sẽ hỏng ở lần refactor thứ hai.

Vì sao Task được mà chat không: Task **có** công tắc (auto-commit per-phase là thứ người dùng bật, và ADR này đã lấy nó làm điều kiện cấp worktree) và **có** điểm ráo — thời điểm chắc chắn không ai đang ghi vào cây gốc — để merge. Lượt chat không có cả hai: người dùng có thể đang tự sửa file trong editor ngay lúc đó.

Ba hệ quả trực tiếp của "không merge":

1. **Lưới F8a trở thành đường sống duy nhất.** Chat không có auto-commit ⇒ gần như mọi subagent có sửa file sẽ kết thúc với một cây bẩn. Commit `WIP: rescued…` lúc release vì thế không còn là trường hợp hiếm mà là đường chính; không có nó thì cô lập subagent = mất trắng việc nó vừa làm.
2. **Branch rỗng phải tự biến mất.** Không merge thì không có ai gọi `git branch -d` sau này, và một subagent chỉ-đọc sẽ để lại rác vĩnh viễn. Lúc release ta thử `git branch -d` (**không bao giờ** `-D`): git tự từ chối branch còn commit chưa nằm trong HEAD, nên đây là guarantee của git chứ không phải phán đoán của AWOG. `ReleaseOutcome.branch` do đó **chỉ** được set khi branch thật sự sống sót — tức là khi có thứ để nói với người dùng. Áp cho **cả hai** owner: với Task nó chỉ thay một lần merge no-op bằng một lần xoá tại chỗ.
3. **Nhả worktree phải chờ subagent chết hẳn.** `abortAll()` chỉ *phát* tín hiệu; vòng lặp pi unwind bất đồng bộ nên một tool call đang bay vẫn ghi được file. `disposeAll()` của toolset vì thế thành `async`: `abortAll()` → `registry.drain(10s)` → nhả worktree; và `run-stream.ts` **await** nó. Không await thì lượt được báo xong trước khi branch tồn tại — người dùng đọc "merge branch X" rồi không thấy X đâu.

Trần: **4** checkout cô lập sống cùng lúc trong một lượt (bằng trần subagent nền và trần scheduler của Task — một mô hình duy nhất cho "AWOG tự fan-out rộng bao nhiêu"), mỗi checkout là một bản sao cây làm việc thật.

Đã cân nhắc và **từ chối**:

- **Auto-merge sau công tắc mới ở Settings.** Thêm một công tắc cho hành vi chưa ai xin là YAGNI, và công tắc đó phải trả lời tiếp "merge lúc nào?" — lượt chat không có điểm ráo nào để trả lời.
- **Cô lập MỌI subagent (không cần model xin).** Từ chối vì đúng lý do ADR này đã từ chối "worktree cho mọi node": checkout sạch không có `node_modules`/`.env`/cache, mà đa số subagent chat là "đọc X rồi báo cáo". Mặc định giữ nguyên hành vi hôm nay; `isolation: "worktree"` là lựa chọn tại call site.
- **Giữ checkout để người dùng vào lấy file (thay vì commit lên branch).** Đúng bằng phương án (b) đã bị từ chối ở F8a: việc "đã cứu" nhưng nằm trong một thư mục dưới `~/.awog` thì vẫn vô hình.

### Kiểm chứng

`src/tasks/__tests__/worktree.test.ts` — **17 test** trên repo git **thật** trong thư mục tạm (`npx vitest@2 run`, 380/380 test của sidecar xanh). Ngoài 10 test cũ của ADR 0081 (giữ nguyên kịch bản, chỉ đổi sang API owner) có thêm 7:

- owner `session` cô lập với `policy: 'always'`, branch `awog/session/<id>/<slug>`, checkout dưới `~/.awog/session-worktrees/…` và **không** đẻ thư mục nào trong `~/.awog/tasks/`;
- subagent chỉ-đọc ⇒ release trả `branch: undefined` và `git branch --list` rỗng;
- subagent có sửa file ⇒ việc lên branch qua commit WIP, `HEAD` của người dùng **không đổi**, `git status` sạch, file **không** xuất hiện trong cây của họ, và một `git merge` do người dùng gõ lấy được về;
- degrade sạch khi cwd không phải git repo, và khi HEAD detached;
- sweeper ở boot dọn **đồng thời** một checkout session mồ côi (cứu việc dở lên branch + `worktree prune` đúng repo nhờ file neo) và một checkout task mồ côi;
- checkout session mồ côi chỉ-đọc ⇒ sweeper dọn cả branch.
