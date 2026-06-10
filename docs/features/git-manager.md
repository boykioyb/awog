# Feature: Git Manager

**Trạng thái:** Draft
**Owner:** Business Analyst
**Tham chiếu Brief:** [git-manager.brief.md](./git-manager.brief.md) (Draft 2026-05-25)
**Ngày tạo:** 2026-05-25

## Mục lục

- [Overview](#overview)
- [Personas](#personas)
- [Multi-repo trong project](#multi-repo-trong-project)
- [Tree view & navigation](#tree-view--navigation)
- [Scope MVP](#scope-mvp)
- [Out of scope](#out-of-scope)
- [User flows](#user-flows)
- [UI structure](#ui-structure)
- [Acceptance Criteria](#acceptance-criteria)
- [Edge cases](#edge-cases)
- [Data model](#data-model)
- [Pinia store](#pinia-store)
- [Sidecar IPC contract](#sidecar-ipc-contract)
- [Workspace dirty policy](#workspace-dirty-policy)
- [Auto-commit per phase](#auto-commit-per-phase)
- [Conflict resolver UI v1](#conflict-resolver-ui-v1)
- [Auth strategy](#auth-strategy)
- [Performance budget](#performance-budget)
- [Security](#security)
- [Dependencies & sequence](#dependencies--sequence)
- [Open questions cho Tech Lead](#open-questions-cho-tech-lead)
- [Test scenarios (input cho QA)](#test-scenarios-input-cho-qa)
- [Tham chiếu](#tham-chiếu)

## Overview

Git Manager là module Native trong AWOG cho phép người dùng review, stage, commit, diff, push, pull, stash, branch và resolve conflict ngay trong app — không phải mở terminal hoặc Git client ngoài. Vì AWOG dùng Git làm cơ chế versioning duy nhất (no-database) và agent commit hàng chục lần per task, UI Git là điều kiện cần để "review artifact-driven" hoạt động.

Module gồm:
- 1 page `/git` với 5 section (Changes / History / Branches / Stash / Remotes).
- 1 Pinia store `stores/git.ts` (state + actions, optimistic update qua sidecar).
- 1 nhóm IPC method `git.*` ở sidecar — mỗi method spawn `git` với `cwd = workspaceRoot` (security invariant #3).
- Tích hợp với Task Execution Engine cho **auto-commit per phase**.
- Tích hợp với Agent Trace để **cross-link commit hash ↔ phase**.
- Tích hợp với NavRail để show **dirty badge** khi workspace có uncommitted change.

## Personas

- **Solo Builder** (persona MVP) — chạy AI guild trên codebase local, quen Git CLI nhưng muốn ở trong AWOG khi đang review artifact agent vừa sinh.
- **Tech Lead** (tương lai) — review code do agent commit theo phase, cần map commit ↔ phase ↔ trace để debug.

Không phải target: người dùng chưa biết Git (MVP không có wizard onboarding Git).

## Multi-repo trong project

Một "project" trong AWOG thường là **folder workspace chứa nhiều repo con** (vd `packages/api`, `services/worker`) — bản thân folder gốc không có `.git`. Trước đây Git Manager chạy `git status` ngay tại `project.path`, gặp folder container thì trả `NO_REPO` và hiện empty state "Workspace has no Git repo" dù bên trong có repo thật.

**Giải pháp:** sidecar quét folder project tìm các git repo, UI cho chọn repo qua dropdown ở header.

- **Discovery (`git.discoverRepos`)** — walk từ `root` tối đa **2 cấp** (`root`, `./<repo>`, `./<group>/<repo>`). Tại mỗi folder, nếu là **repo Git hợp lệ** → ghi nhận và **không** đệ quy sâu hơn. "Hợp lệ" = `.git/` là dir có file `HEAD` (loại bỏ folder `.git` rác — vd chỉ chứa junk subdir, không phải repo thật) **hoặc** `.git` là file bắt đầu bằng `gitdir:` (worktree/submodule). Bỏ qua `node_modules`/`.git`/build dir (dùng chung `SKIP_DIRS` của [`fs/skip-dirs.ts`](../../apps/desktop/sidecar/src/fs/skip-dirs.ts)), không follow symlink, cap 50 repo. Read-only, **không spawn git**. Code: [`git/discover.ts`](../../apps/desktop/sidecar/src/git/discover.ts).
- **Effective git root** — store giữ `selectedRepoPathByProject` per project; `resolveWorkspaceRoot()` trả repo đang chọn, fallback về `project.path` (project single-repo / chưa discover). Mọi `git.*` action vẫn chạy `cwd = repo path` → giữ nguyên security invariant #3.
- **UX** — dropdown repo chỉ hiện khi `repos.length > 1` (project single-repo trông y như cũ). Mặc định chọn root-repo nếu có, ngược lại repo đầu tiên. Đổi repo → reset selection + reload mọi section (invalidate cache branch/remote/history per project để không hiện nhầm repo trước).
- **Project không có repo nào** → vẫn rơi về empty state + CTA "Initialize Git repository" (init tại `project.path`); sau init re-discover để root-repo xuất hiện trong picker.

## Tree view & navigation

- **Header** tối giản: breadcrumb `[project] / [repo?] / [branch]` (repo dropdown chỉ khi >1 repo) + cụm action Fetch/Pull/Push bên phải. Ahead/behind chỉ hiển thị **trên nút** Pull/Push (không lặp ở giữa). Các selector `whitespace-nowrap` + truncate để không vỡ layout khi tên dài.
- **Sidebar Branches** — gom branch theo prefix `/` thành folder gập được (vd `sora-hoa/*` → folder `sora-hoa`); chuỗi 1-con collapse phẳng (collapse singleton). **Folder mặc định đóng** (track tập folder user đã mở). Branch hiện tại tô **accent + đậm** (prop `highlight` của [`GitSidebarItem.vue`](../../apps/desktop/ui/components/git/GitSidebarItem.vue)). Logic build tree: [`utils/branch-tree.ts`](../../apps/desktop/ui/utils/branch-tree.ts).
- **Changes list** — toggle **tree / flat** ở header (mặc định tree, nhớ qua localStorage `awog.git.changes.view`). Tree gom file theo folder (collapse single-child dir chains, **mặc định mở**); flat giữ nguyên virtual-scroll cho > 200 file. Stage all / Unstage all là icon button. Build tree dùng chung [`utils/file-path-tree.ts`](../../apps/desktop/ui/utils/file-path-tree.ts) (cũng dùng cho commit-detail file tree).
- **Folder checkbox (tree view)** — mỗi dir row có checkbox tri-state (checked = mọi file con đã stage, indeterminate = stage một phần, unchecked = chưa stage); click stage/unstage cả folder (lặp per-file `stageFile`/`unstageFile`, giống Stage all). Áp dụng cho cả section Staged (để unstage theo folder).
- **Discard hàng loạt** (AC-10b) — nút **Discard all** (icon thùng rác, hiện khi hover) trên header mỗi section non-staged (Changes / Untracked / Conflicted) discard toàn bộ file trong section; nút **Discard folder** trên dir row (tree view) discard mọi file dưới folder; context-menu file có thêm mục "Discard all ({count})". Tất cả đi qua một confirm dialog count-aware + dùng chung action `discardPaths(paths)` của store (một IPC `git.discardFile` batch — checkout file tracked, unlink file untracked). KHÔNG áp dụng cho section Staged.

## Scope MVP

4 nhóm thao tác đã chốt với user (đầy đủ trong v1):

1. **Status + Stage + Commit**
   - List file working tree theo nhóm: Staged / Unstaged / Untracked / Conflicted.
   - Stage / unstage từng file.
   - Stage / unstage **từng hunk** (sub-file granularity).
   - Commit kèm message; auto-fill template khi commit do AWOG-engine trigger (phase ID + agent + summary).
   - Discard change uncommitted (per file, có confirm).

2. **Diff viewer**
   - Tái dùng diff component từ Artifact System (`.diff` / `.patch` renderer) cho uncommitted diff.
   - Xem diff của một commit cụ thể (full diff hoặc per file).
   - Side-by-side toggle (không bắt buộc, nice-to-have nhưng vẫn nằm trong v1).
   - Hỗ trợ multi-file diff với file header (anchor scroll).

3. **Fetch / Pull / Push**
   - Fetch tất cả remote ref.
   - Pull current branch từ upstream (fast-forward only mặc định; có toggle merge / rebase trong settings).
   - Push current branch lên `origin` (nếu chưa có upstream → tự `--set-upstream`).
   - Surface lỗi auth (SSH key, HTTPS token) lên modal với stderr sanitized.
   - Progress bar realtime (qua streaming event từ sidecar).

4. **Stash + Branch + Resolve conflict**
   - List / save (kèm message) / pop / drop stash.
   - List / create / checkout / delete branch (local + remote-tracking).
   - Basic 2-way conflict resolver: per file, list các conflict block, mỗi block chọn **ours** hoặc **theirs**; "mark resolved" → `git add <file>` qua IPC; sau cùng commit merge.

## Out of scope

Copy từ brief + bổ sung điểm phát hiện trong quá trình spec:

- Rebase interactive, cherry-pick, reset `--hard`/`--mixed` qua UI.
- Submodule, Git LFS, sparse checkout, worktree multi-folder.
- GitHub / GitLab PR review (sẽ là connector v-next).
- Blame view, file history graph kiểu gitk.
- Hooks Git native (`.git/hooks/`) — đã thuộc feature [`hooks`](./hooks.md), không trộn ở đây.
- Quản lý nhiều remote đồng thời (MVP: 1 origin).
- Sign commit (GPG/SSH signing) — config qua workspace, không có UI ở v1.
- Credential manager nội bộ — dựa hoàn toàn vào git credential helper sẵn có của OS.
- **3-way conflict resolver** (chỉ 2-way ở v1; ghi nhận để v2).
- **Tag** (create / list / push tag) — không trong scope v1 (chỉ xuất hiện gián tiếp trong History dưới dạng decoration label).
- **Bisect** UI — out of scope.
- **Reflog viewer** — out of scope.
- **Multi-select commit** trong History để bulk action — out of scope.
- **Search trong history** (filter author / message / path) — out of scope v1, ghi nhận v2.

## User flows

Mỗi flow viết dưới dạng step-by-step actor / system trao đổi qua IPC. Cú pháp: `[Actor]` → action; `[System]` → response. IPC method dùng prefix `git.*` xem [Sidecar IPC contract](#sidecar-ipc-contract).

### Flow 1 — Review & commit changes do agent vừa tạo (golden path artifact-driven)

```
1. [Engine] Phase Architect hoàn tất, ghi artifacts/architecture.md.
   - Nếu autoCommitPerPhase = ON: engine tự chạy git.commit (xem mục Auto-commit).
   - Nếu autoCommitPerPhase = OFF: artifact ghi xuống nhưng KHÔNG commit; chuyển bước 2.
2. [User] Click NavRail Git icon (badge dot vì workspace dirty).
3. [UI] Navigate /git → tab Changes (mặc định).
4. [Store] dispatch git.status (debounced 200ms khi mở page).
5. [Sidecar] spawn `git status --porcelain=v2 -z --branch --untracked-files=all`,
   parse → trả về { branch, ahead, behind, files: GitFileStatus[] }.
6. [UI] Render GitStatusList — file architecture.md ở section Unstaged.
7. [User] Click file → GitDiffViewer load diff (git.diff { path, staged: false }).
8. [Sidecar] spawn `git diff -- <path>` → trả về unified patch.
9. [UI] Render diff với syntax highlight (+, -, @@).
10. [User] Click "Stage file" → store.stageFile(path) → git.stageFile { paths: [path] }.
11. [Sidecar] spawn `git add -- <path>` → success → fire event git:status:changed.
12. [Store] re-fetch git.status; UI update file sang section Staged.
13. [User] Nhập commit message vào GitCommitPanel, click Commit.
14. [Store] git.commit { message, signoff: false } → sidecar `git commit -m "..."`.
15. [UI] Toast "Commit <sha7> tạo thành công"; status list clear; badge dot trên NavRail biến mất.
```

### Flow 2 — Push branch hiện tại lên origin sau khi commit

```
1. [User] Sau Flow 1, click GitCommitPanel → button "Push" (badge "1 ahead").
2. [Store] dispatch git.push { remote: 'origin', branch: currentBranch, setUpstream: <bool> }.
   - setUpstream = true nếu branch chưa có upstream (suy ra từ status response).
3. [Sidecar] spawn `git push [--set-upstream] origin <branch>` (arg array, không shell string).
4. [Sidecar] stream stderr lên UI qua event git:push:progress
   (parse line "Writing objects: 12%" → { phase: 'writing', pct: 12 }).
5. [UI] Modal progress bar (xác định + indeterminate fallback).
6. Case auth fail (exit code != 0, stderr chứa "Permission denied" / "Authentication failed"):
   a. [Sidecar] map stderr → GitAuthError { hint: 'ssh-key' | 'https-token' | 'unknown' }.
   b. [UI] Modal lỗi với copy hướng dẫn ("Kiểm tra SSH agent đang chạy / token HTTPS"),
      và nút "Mở terminal" (deeplink ra terminal app — out of scope v1, fallback chỉ copy command).
   c. KHÔNG retry tự động.
7. Case success: UI toast "Pushed N commits to origin/<branch>".
8. [Store] re-fetch git.status để cập nhật ahead/behind = 0.
```

### Flow 3 — Pull và xử lý khi có conflict

```
1. [User] NavRail Git icon hiển thị badge "1 behind" (sau git.fetch định kỳ — xem Performance).
2. [User] Vào /git, click button "Pull" trong header.
3. [Store] git.pull { strategy: 'ff-only' | 'merge' | 'rebase' (default 'ff-only') }.
4. [Sidecar] spawn `git pull [--ff-only|--no-rebase|--rebase] origin <branch>`, stream progress.
5. Case ff-only success: toast "Pulled N commits, fast-forwarded."
6. Case ff-only fail vì diverge: sidecar trả error code = 'NOT_FAST_FORWARD'
   → UI modal "Branch đã diverge. Chọn cách hợp nhất:" với 2 nút Merge / Rebase.
   - User chọn Merge → re-dispatch git.pull { strategy: 'merge' }.
7. Case merge conflict (exit 1 + stderr "CONFLICT"):
   a. [Sidecar] parse `git status` lại để biết file nào conflicted.
   b. [Sidecar] trả result { ok: false, kind: 'merge_conflict', files: [...] }.
   c. [UI] auto-switch sang section "Conflicted" trong GitStatusList,
      đồng thời modal "Có N file xung đột — mở Conflict Resolver?" với CTA "Resolve now".
8. [User] Click "Resolve now" → GitConflictResolver mở per-file.
9. Xem Flow 6 cho phần resolve.
10. Sau khi resolve hết: UI hiện button "Complete merge" → git.commit (commit merge mặc định message
    "Merge branch 'origin/<branch>'") → workflow trở lại bình thường.
```

### Flow 4 — Stash dirty changes trước khi switch branch

```
1. [User] Đang ở branch feature/foo với 3 file uncommitted.
2. [User] /git → tab Branches → click branch `main` → "Checkout".
3. [Store] git.branchCheckout { name: 'main' }.
4. [Sidecar] thử `git checkout main`:
   - Nếu Git từ chối ("would overwrite uncommitted changes") → exit != 0.
5. [Sidecar] trả error { code: 'DIRTY_TREE', files: [...] }.
6. [UI] Modal "Workspace có change uncommitted. Chọn:" với 3 nút:
   - Stash & checkout → stash trước rồi checkout
   - Force checkout (DANGEROUS — không ưu tiên, hide sau toggle "Advanced")
   - Cancel
7. [User] click "Stash & checkout".
8. [Store] auto-sequence:
   a. git.stashSave { message: 'auto-stash before switch to main', includeUntracked: true }.
   b. git.branchCheckout { name: 'main' } (lần 2).
9. [UI] Toast "Stashed N files, switched to main. Stash hiện trong tab Stash."
10. [User] Sau khi xong việc ở main, switch về feature/foo → manual click "Pop stash".
11. Xem Flow xử lý stash conflict ở edge case.
```

### Flow 5 — Tạo branch mới + checkout

```
1. [User] /git → tab Branches → button "New branch".
2. [UI] Modal:
   - Input "Branch name" (validate: không space, regex Git ref name).
   - Dropdown "From" (default: HEAD; có thể chọn commit từ History hoặc tag).
   - Checkbox "Checkout sau khi tạo" (default ON).
3. [Store] git.branchCreate { name, from: 'HEAD' | <sha>, checkout: true }.
4. [Sidecar] spawn:
   - Nếu checkout = true: `git checkout -b <name> [<from>]`.
   - Nếu false: `git branch <name> [<from>]`.
5. [UI] Refresh branch list, highlight branch mới, header hiện branch hiện tại update.
6. Validate fail (tên invalid, đã tồn tại) → modal hiện inline error, không close.
```

### Flow 6 — Revert một file về version trước (rollback an toàn)

```
1. [User] /git → tab History → click một commit C trong GitHistoryList.
2. [UI] hiện GitDiffViewer với diff của C (so với C^).
3. [User] right-click một file trong diff → "Revert this file to version before C".
4. [UI] Confirm dialog "Sẽ checkout <file> từ commit C^. Change uncommitted của file này sẽ MẤT. Tiếp tục?"
5. [Store] gọi git.checkoutFileAtCommit { path, ref: '<C>^' }.
6. [Sidecar] spawn `git checkout <C>^ -- <path>`.
7. [UI] File xuất hiện trong section Staged (vì checkout stage tự động).
8. [User] có thể commit ngay với message auto-fill "Revert <path> to <C-1 sha7>" hoặc edit.
9. KHÔNG dùng `git revert <C>` (vì revert nguyên commit, scope rộng hơn ý đồ user).
   Quyết định BA: per-file rollback dùng `checkout <ref> -- <path>`, không expose `git revert` UI ở v1.
```

## UI structure

### Page `/git` — layout chung

3-pane layout chuẩn AWOG (tham chiếu `pages/tasks/index.vue`):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TopBar (branch picker | fetch button | pull/push button | status icons)  │
├──────────┬──────────────────────────────┬────────────────────────────────┤
│ Section  │  Center pane                 │  Right pane                    │
│ tabs     │  (file list / commit list /  │  (Commit panel / Diff viewer / │
│  Changes │   branch list / stash list)  │   Conflict resolver)           │
│  History │                              │                                │
│  Branches│                              │                                │
│  Stash   │                              │                                │
│  Remotes │                              │                                │
└──────────┴──────────────────────────────┴────────────────────────────────┘
```

- Tab Changes (default): Center = `GitStatusList`, Right = `GitCommitPanel` + `GitDiffViewer` (split vertical 50/50, có thể drag resize).
- Tab History: Center = `GitHistoryList` (commit list), Right = `GitDiffViewer` của commit selected.
- Tab Branches: Center = `GitBranchList`, Right = chi tiết branch (last commit, ahead/behind, upstream).
- Tab Stash: Center = `GitStashList`, Right = `GitDiffViewer` của stash selected.
- Tab Remotes: Center = list remote (1 entry "origin" ở MVP), Right = readonly info (URL, fetch URL, push URL).

### Components dự kiến

| Component | Path | Vai trò |
|---|---|---|
| `GitStatusList.vue` | `apps/desktop/ui/components/git/GitStatusList.vue` | List file change theo 4 section (Staged / Unstaged / Untracked / Conflicted). Mỗi item có checkbox stage, action menu, status badge. |
| `GitDiffViewer.vue` | `apps/desktop/ui/components/git/GitDiffViewer.vue` | Render unified patch; tái dùng diff renderer từ Artifact System. Hỗ trợ multi-file. Cho phép expand/collapse hunk. Hover hunk hiện button "Stage hunk" / "Discard hunk". |
| `GitCommitPanel.vue` | `apps/desktop/ui/components/git/GitCommitPanel.vue` | Textarea message (Monaco hoặc plain textarea với syntax highlight Git commit message). Footer: button Commit / Commit & Push / Amend. Hiển thị template auto-fill nếu user click "Use phase template". |
| `GitBranchList.vue` | `apps/desktop/ui/components/git/GitBranchList.vue` | Local branches + Remote branches (collapsible group). Current branch highlight. Action menu: checkout / rename / delete / merge into current. |
| `GitStashList.vue` | `apps/desktop/ui/components/git/GitStashList.vue` | List stash entries. Click → diff preview. Action: pop / apply / drop. |
| `GitHistoryList.vue` | `apps/desktop/ui/components/git/GitHistoryList.vue` | Commit list (limit 100 ban đầu, pagination "Load more"). Mỗi item: avatar (initials), author, sha7, message line 1, date relative. Decoration label cho branch/tag. **Crosslink phase**: nếu commit có phase metadata → icon link clickable → navigate tới phase detail. |
| `GitConflictResolver.vue` | `apps/desktop/ui/components/git/GitConflictResolver.vue` | Per-file resolver. List conflict block (parse `<<<<<<<` / `=======` / `>>>>>>>`). Mỗi block 2 nút "Take ours" / "Take theirs" (mutually exclusive). Footer: button "Mark resolved" (gọi git.resolveFile). |
| `GitRemoteList.vue` | `apps/desktop/ui/components/git/GitRemoteList.vue` | List remote, readonly info. Button "Fetch this remote". |
| `GitAuthErrorModal.vue` | `apps/desktop/ui/components/git/GitAuthErrorModal.vue` | Modal khi push/pull fail vì auth. Sanitize stderr. Có "Copy command" để user paste vào terminal. |
| `GitProgressBar.vue` | `apps/desktop/ui/components/git/GitProgressBar.vue` | Realtime progress của fetch/pull/push (subscribe event stream). |
| `NavRailGitBadge.vue` | (sửa component NavRail hiện có) | Dot indicator khi workspace dirty hoặc ahead/behind > 0. |

### Theme rule

- Tất cả màu đi qua `useTheme()`: `t.bg`, `t.bgPanel`, `t.bgInput`, `t.border`, `t.text`, `t.textDim`, `t.accent`, `t.accentText`.
- Diff màu xanh/đỏ tái dùng token đã có cho `.diff` viewer (`t.diffAdded`, `t.diffRemoved`, `t.diffContext`).
- Conflict block: ours = `t.diffOurs` (xanh dương nhạt), theirs = `t.diffTheirs` (tím nhạt). **Cần TL/Designer xác nhận token** — nếu chưa có, thêm vào `utils/themes.ts`.
- NavRail dirty dot: `t.warning`. Ahead/behind badge: `t.accent`.

## Acceptance Criteria

> Convention: `AC-NN` đánh số liên tục. Mỗi AC dạng Given/When/Then, verify được trong UI hoặc qua IPC log.

### Nhóm 1 — Status + Stage + Commit

**AC-01: List status file working tree**
- **Given** workspace có Git init, current branch = `feature/x`, 2 file unstaged + 1 file untracked.
- **When** user mở `/git` (tab Changes).
- **Then** `GitStatusList` render đúng 3 section: 0 Staged, 2 Unstaged, 1 Untracked, 0 Conflicted; mỗi file hiển thị path relative tới workspace root, status badge (M/A/D/?/U), kích thước thay đổi (`+12 -3`).

**AC-02: Stage single file**
- **Given** file `architecture.md` ở Unstaged.
- **When** user click checkbox stage trên item file đó.
- **Then** trong < 500ms, file di chuyển sang section Staged; sidecar đã chạy `git add -- architecture.md`; store re-fetch status; KHÔNG có Toast (action nhẹ, không cần feedback explicit).

**AC-03: Unstage single file**
- **Given** file `architecture.md` ở Staged.
- **When** user click checkbox stage (untick).
- **Then** sidecar chạy `git reset HEAD -- architecture.md` (hoặc `git restore --staged` nếu Git >= 2.23), file về Unstaged.

**AC-04: Stage hunk**
- **Given** file `architecture.md` ở Unstaged có 3 hunk.
- **When** user hover hunk #2 trong `GitDiffViewer` và click button "Stage hunk".
- **Then** chỉ hunk #2 vào Staged; file vẫn xuất hiện ở Unstaged (do còn hunk #1 và #3 chưa staged) và đồng thời ở Staged. Re-render diff phải phản ánh đúng.
- **Implementation note:** sidecar gọi `git apply --cached <patch>` với patch chỉ chứa hunk được chọn (BA decision: dùng `git apply --cached` thay vì `git add -p` interactive).

**AC-05: Stage all**
- **Given** ≥ 1 file Unstaged.
- **When** user click button "Stage all" ở header section Unstaged.
- **Then** sidecar chạy `git add -A -- <paths>` (paths = từng file unstaged được liệt kê, KHÔNG dùng `git add -A` không argument để tránh stage file ngoài ý muốn nếu working dir bị thay đổi giữa fetch và stage).

**AC-06: Commit với message valid**
- **Given** ≥ 1 file ở Staged, user gõ message "feat: add architecture doc".
- **When** user click button Commit trong `GitCommitPanel`.
- **Then** sidecar chạy `git commit -m "feat: add architecture doc"`; trả về sha mới; UI clear staged list; toast "Commit <sha7>"; History list update với commit mới ở đầu.

**AC-07: Commit với message rỗng → block**
- **Given** Staged có file, message textarea trống.
- **When** user click Commit.
- **Then** UI inline error "Commit message không được rỗng"; KHÔNG gọi IPC.

**AC-08: Commit khi staged rỗng → block**
- **Given** Staged section rỗng, có message.
- **When** user click Commit.
- **Then** UI inline warning "Không có thay đổi để commit"; button Commit disabled.

**AC-09: Amend last commit**
- **Given** có commit gần nhất, staged có file mới (hoặc chỉ thay message).
- **When** user click overflow menu "Amend last commit" trong `GitCommitPanel`, sửa message, confirm.
- **Then** sidecar chạy `git commit --amend -m "<new>"`; History list cập nhật (sha cũ disappear, sha mới ở đầu). Confirm dialog cảnh báo "Amend thay đổi hash commit — không amend commit đã push" nếu branch hiện tại có upstream và HEAD chưa ahead.

**AC-10: Discard change uncommitted (per file)**
- **Given** file ở Unstaged.
- **When** user click action menu "Discard changes" trên file → confirm dialog.
- **Then** sidecar chạy `git checkout -- <path>` (hoặc `git restore <path>`); file biến khỏi list; KHÔNG có undo.
- Confirm dialog có copy: "Sẽ xóa vĩnh viễn change uncommitted của <path>. Tiếp tục?"

**AC-10b: Discard hàng loạt (section / folder)**
- **Given** section non-staged (Changes / Untracked / Conflicted) hoặc một folder trong tree view có ≥ 1 file.
- **When** user click **Discard all** ở header section / **Discard folder** ở dir row / "Discard all ({count})" trong context-menu → confirm dialog count-aware ("{count} thay đổi chưa commit trong '{target}' sẽ mất vĩnh viễn. Tiếp tục?").
- **Then** store gọi `discardPaths(paths)` → một IPC `git.discardFile` batch (checkout tracked + unlink untracked); các file biến khỏi list; rollback optimistic nếu IPC lỗi.
- Section **Staged** KHÔNG có discard hàng loạt (chỉ unstage all).

### Nhóm 2 — Diff viewer

**AC-11: Diff uncommitted**
- **Given** file `architecture.md` ở Unstaged.
- **When** user click file trong `GitStatusList`.
- **Then** `GitDiffViewer` load và render diff của file đó (gọi `git.diff { path, staged: false }`); hiển thị unified patch với syntax highlight + line numbers.

**AC-12: Diff staged**
- **Given** file ở Staged.
- **When** user click file.
- **Then** Diff viewer hiển thị diff giữa staged và HEAD (`git diff --cached -- <path>`).

**AC-13: Diff của commit cụ thể**
- **Given** History tab, có commit list.
- **When** user click commit C.
- **Then** `GitDiffViewer` hiển thị diff của C so với C^ (multi-file); mỗi file có header collapsible.

**AC-14: Diff multi-file scroll**
- **Given** commit C thay đổi 5 file.
- **When** user click file trong sidebar list ở header diff viewer.
- **Then** scroll smooth tới anchor của file đó trong diff viewer.

**AC-15: Diff cho file binary**
- **Given** commit C thay đổi 1 file `.png`.
- **When** user click commit C.
- **Then** Diff viewer hiển thị placeholder "Binary file changed (X bytes → Y bytes)"; không cố parse content.

### Nhóm 3 — Fetch / Pull / Push

**AC-16: Fetch all remote**
- **Given** workspace có 1 remote `origin`.
- **When** user click button Fetch ở TopBar (hoặc auto-fetch định kỳ — xem [Performance budget](#performance-budget)).
- **Then** sidecar chạy `git fetch --all --prune`; UI hiện progress bar; sau khi xong, branch list cập nhật remote-tracking; ahead/behind count cập nhật.

**AC-17: Pull fast-forward**
- **Given** branch local trước upstream 0 commit, sau 3 commit (behind 3).
- **When** user click Pull.
- **Then** sidecar `git pull --ff-only origin <branch>`; success → toast "Pulled 3 commits (fast-forward)"; History list update.

**AC-18: Pull fail vì diverge**
- **Given** branch diverge (cả ahead lẫn behind).
- **When** user click Pull (mặc định ff-only).
- **Then** sidecar exit != 0; UI modal "Branch đã diverge" với 2 nút Merge / Rebase + Cancel. Không tự ý chọn strategy.

**AC-19: Push branch chưa có upstream**
- **Given** branch `feature/x` chưa có upstream, ahead 2 commit.
- **When** user click Push.
- **Then** UI confirm dialog "Branch chưa có upstream. Push và set upstream tới origin/feature/x?"; user confirm → sidecar `git push --set-upstream origin feature/x`; success → toast.

**AC-20: Push fail vì auth**
- **Given** SSH key chưa add vào agent / token HTTPS hết hạn.
- **When** push.
- **Then** sidecar parse stderr → trả `GitAuthError { hint: 'ssh-key' | 'https-token' | 'unknown', sanitizedMessage }`; UI hiện `GitAuthErrorModal` với hint copy phù hợp. **Không** lưu credential trong AWOG. **Không** retry tự động.

**AC-21: Push fail vì non-fast-forward**
- **Given** remote có commit mới mà local chưa pull.
- **When** push.
- **Then** UI modal "Remote có commit mới. Pull trước rồi push?" với CTA "Pull then push" (auto-sequence) hoặc "Cancel". KHÔNG expose `--force` ở UI v1.

**AC-22: Progress streaming**
- **Given** push/pull/fetch lâu (> 1s).
- **When** sidecar chạy.
- **Then** UI hiển thị `GitProgressBar` cập nhật theo event stream (`git:push:progress` / `git:pull:progress` / `git:fetch:progress`); ít nhất 1 event / 250ms khi có progress. Khi không parse được percent → fallback indeterminate bar.

### Nhóm 4 — Stash + Branch + Resolve conflict

**AC-23: Stash save**
- **Given** workspace dirty (3 file unstaged + 1 file untracked).
- **When** user click "Stash" ở header tab Changes, nhập message "WIP refactor".
- **Then** sidecar `git stash push -u -m "WIP refactor"` (`-u` để include untracked); workspace clean; Stash tab có entry mới `stash@{0}` "WIP refactor".

**AC-24: Stash pop**
- **Given** Stash list có `stash@{0}`.
- **When** user click entry → menu "Pop".
- **Then** sidecar `git stash pop`; nếu apply sạch → entry biến mất, Changes tab có file trở lại. Nếu conflict → xem AC-32.

**AC-25: Stash drop**
- **Given** Stash list có ≥ 1 entry.
- **When** user click "Drop" trên entry → confirm.
- **Then** sidecar `git stash drop stash@{N}`; entry biến mất; KHÔNG có undo.

**AC-26: Branch list**
- **Given** workspace có 3 local branch + 2 remote-tracking.
- **When** user mở tab Branches.
- **Then** `GitBranchList` render 2 group: "Local (3)" và "Remote (2)"; branch hiện tại có icon riêng + label "current"; mỗi branch hiển thị upstream + ahead/behind.

**AC-27: Branch create**
- **Given** user ở `main`.
- **When** click "New branch", nhập `feature/y`, check "Checkout sau khi tạo".
- **Then** sidecar `git checkout -b feature/y`; current branch update; toast "Created feature/y from main".

**AC-28: Branch create với tên invalid**
- **Given** user nhập tên có space hoặc ký tự cấm (`~`, `^`, `:`, `?`, `*`, `[`, `..`, `@{`).
- **When** click Create.
- **Then** UI inline error "Tên branch không hợp lệ"; KHÔNG gọi IPC. (Validate ở UI lẫn sidecar — defense in depth.)

**AC-29: Branch checkout — clean tree**
- **Given** workspace clean, user click branch khác trong `GitBranchList` → "Checkout".
- **Then** sidecar `git checkout <branch>`; current branch update; UI refresh status/history.

**AC-30: Branch checkout — dirty tree (xem Flow 4)**
- **Given** workspace dirty.
- **When** user checkout branch khác.
- **Then** sidecar trả `DIRTY_TREE` error; UI modal 3 lựa chọn (Stash & checkout / Force / Cancel); xem [Flow 4](#flow-4--stash-dirty-changes-trước-khi-switch-branch).

**AC-31: Branch delete**
- **Given** branch `feature/old` không phải current, đã merge.
- **When** user click "Delete".
- **Then** sidecar `git branch -d feature/old`; success → list update.
- **Given** branch chưa merge.
- **When** delete.
- **Then** sidecar trả error `UNMERGED`; UI modal "Branch chưa merge. Force delete (mất commit)?" với CTA "Force delete" → `git branch -D` (DANGEROUS, có confirm thứ hai).

**AC-32: Conflict resolver — open**
- **Given** vừa merge fail (Flow 3) hoặc stash pop fail, có ≥ 1 file conflicted.
- **When** user click file conflicted trong `GitStatusList`.
- **Then** Right pane switch từ `GitDiffViewer` sang `GitConflictResolver`; parse file content, list các conflict block.

**AC-33: Conflict resolver — choose ours/theirs per block**
- **Given** file có 3 conflict block.
- **When** user click "Take ours" cho block 1, "Take theirs" cho block 2, để block 3 chưa chọn.
- **Then** UI hiển thị 2/3 block đã có lựa chọn; button "Mark resolved" disabled (vì block 3 chưa chọn).

**AC-34: Conflict resolver — mark resolved**
- **Given** tất cả block đã chọn ours/theirs.
- **When** user click "Mark resolved".
- **Then**
  - Sidecar nhận `git.resolveFile { path, resolutions: [{ blockIndex, choice }] }`.
  - Sidecar tạo content mới bằng cách thay từng block với content tương ứng, ghi đè file.
  - Sidecar chạy `git add -- <path>`.
  - UI file di chuyển từ Conflicted sang Staged.
  - Nếu tất cả file conflicted đã resolved → UI hiện button "Complete merge" để commit.

**AC-35: Complete merge**
- **Given** không còn file conflicted, đang ở giữa merge (file `.git/MERGE_HEAD` tồn tại).
- **When** user click "Complete merge".
- **Then** sidecar `git commit --no-edit` (dùng message merge mặc định) hoặc cho phép user edit message. Workspace clean. Toast "Merge completed".

**AC-36: Merge abort**
- **Given** đang giữa merge (chưa resolve hết).
- **When** user click "Abort merge".
- **Then** confirm dialog "Bỏ qua merge và quay lại trạng thái trước?"; sidecar `git merge --abort`; workspace về trước merge.

### Nhóm 5 — Cross-cutting (auto-commit, dirty policy, cross-link)

**AC-37: Auto-commit per phase — ON**
- **Given** Settings → Workspace → "Auto-commit per phase" = ON, format template = `[<phase-id>] <agent>: <summary>`.
- **When** Engine hoàn tất phase Architect (artifact ghi `architecture.md`).
- **Then** Engine tự gọi IPC nội bộ `git.commit { message: <template-filled>, paths: <artifacts của phase> }`. Commit message: `[N_arch] Architect: design partitioned scheduler`. Trace event `artifact.write` của phase đó được append thêm field `commitSha`.

**AC-38: Auto-commit per phase — OFF**
- **Given** "Auto-commit per phase" = OFF.
- **When** Engine hoàn tất phase.
- **Then** Artifact ghi xuống nhưng KHÔNG commit; NavRail Git icon có badge dot dirty; user chủ động vào `/git` commit.

**AC-39: Cross-link commit ↔ phase**
- **Given** commit do auto-commit tạo, message có pattern `[<phase-id>]`.
- **When** user click commit trong `GitHistoryList`.
- **Then** UI hiển thị bên phải diff + một block "Linked phase: N_arch (Task tsk-001)" với link clickable; click → navigate `/tasks/tsk-001#phase=N_arch`.
- **Implementation note:** parse commit message regex `^\[(?<phaseId>[^\]]+)\]` ở UI để lookup phase. **Không** dùng git-notes (out of scope; quyết định BA — message-based parsing đủ cho v1).

**AC-40: Workspace dirty badge ở NavRail**
- **Given** workspace có ≥ 1 file uncommitted (unstaged / staged / untracked).
- **When** UI subscribe event `git:status:changed` từ sidecar.
- **Then** NavRail Git icon hiển thị dot (`t.warning`). Khi clean → dot biến mất.

**AC-41: Workspace dirty warn khi chạy task mới**
- **Given** workspace dirty, user click "New task" trong /tasks.
- **When** Engine chuẩn bị start task.
- **Then** Modal warning "Workspace có change uncommitted. Recommend commit hoặc stash trước. Tiếp tục?" với 3 nút: "Commit changes" (deeplink /git), "Stash & continue" (auto-stash), "Continue anyway". KHÔNG block hard. Có toggle "Đừng hỏi lại trong session này".
- **Default policy quyết định BA:** warn (không block); user có thể bật "Auto-stash" trong Settings để skip dialog.

**AC-42: Detached HEAD warning**
- **Given** workspace ở detached HEAD (sau khi user checkout commit cụ thể từ History).
- **When** UI render TopBar.
- **Then** branch picker hiển thị badge "DETACHED at <sha7>" màu cảnh báo. Commit thử nghiệm vẫn cho phép nhưng modal cảnh báo "Commit ở detached HEAD sẽ mất nếu không tạo branch — Create branch?" trước khi commit.

### Nhóm 6 — Performance & resilience

**AC-43: Status sub-200ms cho repo nhỏ-vừa**
- **Given** repo có ≤ 2000 file tracked.
- **When** gọi `git.status`.
- **Then** response time end-to-end (sidecar spawn → UI render xong) < 200ms ở máy dev tham chiếu (M-class CPU). Đo qua trace.

**AC-44: Status với repo lớn (> 10k file)**
- **Given** repo có > 10k file tracked, > 1k file change.
- **When** gọi `git.status`.
- **Then** sidecar dùng `git status --porcelain=v2` (không `--ignored`); response time < 1s; UI render virtual scroll (chỉ render rows visible + 10 buffer); status list scroll mượt (60fps).

**AC-45: Cancellation**
- **Given** push đang chạy (> 5s).
- **When** user click "Cancel" trong progress modal.
- **Then** sidecar SIGTERM process git; UI revert về trạng thái trước; toast "Push cancelled". Repo state có thể không nhất quán nếu Git đã ghi một phần — sidecar tự `git.status` sau cancel để re-sync UI.

## Edge cases

| Edge case | Behavior |
|---|---|
| Workspace chưa init Git (không có `.git/`) | Page `/git` hiển thị empty state với CTA "Initialize Git repo" → gọi `git.init` (IPC mới: `git.init`). Sau init, refresh page. |
| Detached HEAD | Banner cảnh báo (AC-42); commit cho phép nhưng cảnh báo; push disabled (no upstream); checkout branch hoạt động bình thường. |
| Empty repo (chưa có commit nào) | History tab empty state; Commit panel cho phép commit đầu tiên (`git commit`); Branches tab chỉ hiện branch mặc định chưa có ref. |
| Untracked binary file | List bình thường; Diff viewer hiển thị placeholder "Binary file" như AC-15; staging vẫn được. |
| Merge conflict trong file binary | Conflict resolver KHÔNG support (không parse được block). UI hiển thị message "Binary conflict — cần resolve qua tool ngoài. Sau khi resolve, click 'Mark resolved' để stage." Vẫn có nút "Take ours" / "Take theirs" ở mức file (gọi `git checkout --ours/--theirs -- <path>`). |
| File rename detection | `git.status` dùng `-z` + parse rename record `R100`; UI hiển thị "renamed: old → new" thay vì add+delete. Diff viewer dùng `git diff --find-renames`. |
| CRLF vs LF | Tôn trọng `core.autocrlf` của workspace. KHÔNG normalize trong AWOG. Khi hiển thị diff, hiện badge nhỏ nếu line ending thay đổi (`CRLF→LF`). |
| Performance > 10k file | AC-44 — virtual scroll, không `--ignored`. |
| Performance > 1000 file change | AC-44 — virtual scroll. Stage all / Discard all bật confirm dialog với count. |
| Auth fail SSH | AC-20 — hint "ssh-key", copy "Hãy chạy `ssh-add` để add key vào agent". |
| Auth fail HTTPS token | AC-20 — hint "https-token", copy "Cập nhật token qua git credential helper / Keychain". |
| Remote không tồn tại | sidecar trả `REMOTE_NOT_FOUND`; UI modal "Remote 'origin' không tồn tại — cấu hình URL?". Add remote UI **out of scope v1** (user dùng CLI `git remote add`). |
| Network offline | Fetch/pull/push fail với stderr "Could not resolve host"; sidecar map → `NETWORK_ERROR`; UI toast "Mạng không khả dụng — kiểm tra kết nối". KHÔNG retry tự động. |
| Agent đang commit lúc user click commit thủ công | Sidecar dùng **mutex per workspace** (single in-flight git mutation). Lệnh thứ 2 chờ queue (tối đa 5s timeout) → trả `BUSY`. UI disable Commit button trong khi action đang chạy. |
| File bị lock bởi OS (Windows) | `git add` fail với stderr "Permission denied"; sidecar trả `FILE_LOCKED { path }`; UI toast cụ thể "File <path> đang bị lock bởi process khác". |
| Commit message empty | AC-07. |
| Path có space / unicode / emoji | Sidecar luôn pass path qua arg array (KHÔNG shell string), dùng `git -z` với null-separated output để parse an toàn. Path quote khi hiển thị UI nhưng KHÔNG modify. |
| Stash pop conflict | `git stash pop` exit != 0 với CONFLICT; sidecar KHÔNG drop stash (Git mặc định giữ stash nếu conflict); UI hiện modal "Pop có conflict — file đã apply (có conflict), stash@{0} vẫn còn. Resolve conflict, sau đó drop stash thủ công." |
| Workspace path bị move/rename giữa session | Khi sidecar bắt `ENOENT` trên `cwd`, trả `WORKSPACE_NOT_FOUND`; UI hiện modal "Workspace folder không tồn tại — cập nhật path trong Settings"; disable mọi git action. |
| Rất nhiều file change (> 1000) | Virtual scroll (AC-44); pagination Load more nếu cần; stage all confirm "Stage 1234 file?". |
| Commit message có ký tự đặc biệt (`"`, `\n`, ``` ` ``` ) | Sidecar pass message qua arg array (`-m <msg>`), KHÔNG dùng shell string. Multi-line message: dùng `-F -` đọc từ stdin nếu message chứa `\n`. |
| Phase trigger auto-commit nhưng artifact chưa thực sự thay đổi (no diff) | Sidecar detect `git diff --cached --quiet` trước commit; nếu không có diff → skip commit, log "No changes for phase X"; KHÔNG fail phase. |
| 2 task chạy concurrent cùng auto-commit | Concurrency MVP = 1 worker (xem [execution-model](../architecture/execution-model.md)) → không xảy ra trong MVP. Ghi nhận v2: cần per-workspace mutex. |
| Git binary không cài trên máy | Sidecar spawn fail `ENOENT`; UI hiện banner full-page "Git CLI không được tìm thấy. Cài Git rồi restart AWOG." với link tới `https://git-scm.com/downloads`. Block toàn bộ page `/git`. |
| Git version quá cũ (< 2.23) | Một số command (`git restore`) không có; sidecar fallback (`git reset` / `git checkout`). Yêu cầu tối thiểu Git **>= 2.20** (BA decision, lý do: porcelain=v2 cần >= 2.11, một số option rename detection cần 2.20). Detect version qua `git --version` lúc bootstrap; nếu < 2.20 → banner warning. |
| User Discard task đang waiting_approval | Task xử lý theo flow Task hiện có; KHÔNG ảnh hưởng Git workspace state. |
| Workspace có submodule | Status hiển thị submodule như folder thường (modified); KHÔNG có UI sub-action cho submodule. User vẫn dùng CLI cho submodule. |

## Data model

### Bổ sung vào `apps/desktop/ui/types/index.ts`

```ts
// ─── Git ────────────────────────────────────────────────────────────────────

export type GitFileChangeType =
  | 'added'        // A: file mới ở index
  | 'modified'     // M
  | 'deleted'      // D
  | 'renamed'      // R
  | 'copied'       // C
  | 'untracked'    // ?
  | 'ignored'      // !
  | 'conflicted'   // U (unmerged)
  | 'type_changed' // T

export type GitFileStageState = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export interface GitFileStatus {
  path: string                  // relative tới workspace root
  oldPath?: string              // chỉ khi rename / copy
  changeType: GitFileChangeType
  stageState: GitFileStageState
  isBinary: boolean
  additions?: number            // null nếu binary
  deletions?: number
  lineEndingChanged?: 'CRLF→LF' | 'LF→CRLF'
}

export interface GitStatus {
  branch: string | null         // null nếu detached
  detached: boolean
  detachedAt?: string           // sha7 nếu detached
  upstream: string | null       // ví dụ "origin/feature/x"
  ahead: number
  behind: number
  files: GitFileStatus[]
  isMerging: boolean            // .git/MERGE_HEAD tồn tại
  isRebasing: boolean
  conflictedCount: number
}

export interface GitCommit {
  sha: string                   // full 40-char
  sha7: string                  // short
  authorName: string
  authorEmail: string
  authorAt: string              // ISO
  committerName: string
  committerAt: string
  message: string               // full message (subject + body)
  subject: string               // dòng đầu
  parents: string[]             // sha của parent commit (≥ 2 nếu merge)
  refs: GitRef[]                // decoration: branch / tag pointing tới commit này
  // AWOG-specific (parse từ message):
  linkedPhaseId?: string        // suy ra từ regex ^\[(phaseId)\]
  linkedTaskId?: string         // suy ra từ context (current task khi commit) — out of scope auto-link, manual via message
}

export interface GitRef {
  name: string                  // "main", "origin/main", "v1.0.0"
  kind: 'branch' | 'remote-branch' | 'tag' | 'HEAD'
}

export interface GitBranch {
  name: string                  // local: "feature/x"; remote: "origin/feature/x"
  kind: 'local' | 'remote'
  isCurrent: boolean
  upstream: string | null       // chỉ áp dụng cho local
  ahead: number                 // so với upstream
  behind: number
  lastCommitSha: string
  lastCommitSubject: string
  lastCommitAt: string
}

export interface GitStashEntry {
  index: number                 // 0, 1, 2 → "stash@{0}"
  message: string               // "WIP on feature/x: <sha7> <subject>"
  userMessage?: string          // message do user pass khi `stash push -m`
  createdAt: string             // ISO
  baseSha: string               // sha của HEAD lúc stash
  baseBranch: string
}

export interface GitRemote {
  name: string                  // "origin"
  fetchUrl: string
  pushUrl: string
}

// Repo phát hiện trong folder project (xem "Multi-repo trong project").
export interface GitRepoEntry {
  path: string                  // absolute path tới repo root (folder chứa .git)
  name: string                  // basename(path)
  relativePath: string          // path tương đối project root; '.' nếu root là repo
  isRoot: boolean               // true khi path === project root
}

export interface GitDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string                // "@@ -10,7 +10,8 @@"
  lines: GitDiffLine[]
}

export interface GitDiffLine {
  kind: 'context' | 'add' | 'del' | 'noeol'
  oldLineNum?: number
  newLineNum?: number
  content: string
}

export interface GitFileDiff {
  path: string
  oldPath?: string              // rename
  isBinary: boolean
  isRename: boolean
  hunks: GitDiffHunk[]
  oldFileMode?: string          // "100644"
  newFileMode?: string
}

export interface GitDiff {
  files: GitFileDiff[]
}

export interface GitMergeConflictBlock {
  index: number                 // 0-based block index trong file
  startLine: number             // line của <<<<<<< (1-based)
  separatorLine: number         // line của =======
  endLine: number               // line của >>>>>>>
  ours: string[]                // lines giữa <<< và ===
  theirs: string[]              // lines giữa === và >>>
  oursLabel: string             // ví dụ "HEAD"
  theirsLabel: string           // ví dụ "origin/main"
}

export interface GitMergeConflictFile {
  path: string
  isBinary: boolean
  blocks: GitMergeConflictBlock[]  // empty nếu binary
}

export type GitConflictResolution =
  | { blockIndex: number; choice: 'ours' | 'theirs' }
  | { blockIndex: number; choice: 'manual'; content: string }  // v2, không bắt buộc v1
```

### Cross-link với entity hiện có

- **Task / Phase / Run ↔ GitCommit:**
  - Engine khi auto-commit gọi `git.commit` với message format `[<phaseId>] <agentName>: <summary>` (xem [Auto-commit per phase](#auto-commit-per-phase)).
  - Sau khi commit, engine append trace event mới `artifact.commit` vào `events.log`:
    ```
    { type: 'artifact.commit', taskId, phaseId, runVersion, commitSha, at }
    ```
  - UI khi render commit trong `GitHistoryList` parse `linkedPhaseId` từ message → fetch phase từ store → render link.
- **Artifact ↔ GitCommit:**
  - Artifact System đã version qua Git; mỗi version artifact = một commit. UI artifact viewer (markdown editor) có thể link "View commit" → deeplink `/git?tab=history&commit=<sha>`.
- **Workspace dirty ↔ NavRail:**
  - Store `git.ts` expose getter `isDirty: ComputedRef<boolean>`; NavRail subscribe.

### File system layout

- Git data: `.git/` dưới `workspace/` (gốc workspace root).
- Settings auto-commit: `workspace/.awog/settings.json` (đã có theo settings feature).
- KHÔNG có file metadata riêng cho Git Manager — toàn bộ state đi qua `git` CLI và `git.status` mỗi lần.

## Pinia store

File mới: `apps/desktop/ui/stores/git.ts`.

```ts
// State (ref)
const status = ref<GitStatus | null>(null)             // null = chưa load lần đầu
const commits = ref<GitCommit[]>([])                   // history, paginate
const branches = ref<GitBranch[]>([])
const stashes = ref<GitStashEntry[]>([])
const remotes = ref<GitRemote[]>([])
const currentDiff = ref<GitDiff | null>(null)          // diff đang hiển thị
const currentConflictFile = ref<GitMergeConflictFile | null>(null)
const loading = reactive({
  status: false, diff: false, history: false, push: false, pull: false, fetch: false,
})
const lastError = ref<{ kind: string; message: string } | null>(null)
const progress = ref<{ op: 'fetch' | 'pull' | 'push'; pct: number | null } | null>(null)

// Getters (computed)
const isDirty = computed(() => (status.value?.files.length ?? 0) > 0)
const isMerging = computed(() => status.value?.isMerging ?? false)
const hasConflicts = computed(() => (status.value?.conflictedCount ?? 0) > 0)
const currentBranch = computed(() => status.value?.branch ?? null)
const aheadBehind = computed(() => ({
  ahead: status.value?.ahead ?? 0,
  behind: status.value?.behind ?? 0,
}))
const stagedFiles = computed(() => status.value?.files.filter(f => f.stageState === 'staged') ?? [])
const unstagedFiles = computed(() => status.value?.files.filter(f => f.stageState === 'unstaged') ?? [])
const untrackedFiles = computed(() => status.value?.files.filter(f => f.stageState === 'untracked') ?? [])
const conflictedFiles = computed(() => status.value?.files.filter(f => f.stageState === 'conflicted') ?? [])

// Actions
async function fetchStatus(): Promise<void>
async function fetchHistory(opts?: { limit?: number; before?: string }): Promise<void>
async function fetchBranches(): Promise<void>
async function fetchStashes(): Promise<void>
async function fetchRemotes(): Promise<void>
async function loadDiff(opts: { path?: string; staged?: boolean; commit?: string }): Promise<void>
async function loadConflictFile(path: string): Promise<void>

async function stageFile(path: string): Promise<void>            // optimistic
async function unstageFile(path: string): Promise<void>
async function stageHunk(path: string, hunkIndex: number): Promise<void>
async function stageAll(paths: string[]): Promise<void>
async function discardFile(path: string): Promise<void>

async function commit(message: string, opts?: { amend?: boolean }): Promise<{ sha: string }>
async function fetch(remote?: string): Promise<void>
async function pull(strategy: 'ff-only' | 'merge' | 'rebase'): Promise<void>
async function push(opts: { setUpstream?: boolean }): Promise<void>

async function stashSave(message: string, includeUntracked: boolean): Promise<void>
async function stashPop(index: number): Promise<{ hasConflict: boolean }>
async function stashDrop(index: number): Promise<void>

async function branchCreate(name: string, from: string, checkout: boolean): Promise<void>
async function branchCheckout(name: string, opts?: { force?: boolean }): Promise<void>
async function branchDelete(name: string, force: boolean): Promise<void>

async function resolveFile(path: string, resolutions: GitConflictResolution[]): Promise<void>
async function mergeAbort(): Promise<void>
async function completeMerge(message?: string): Promise<void>

async function checkoutFileAtCommit(path: string, ref: string): Promise<void>   // revert per file
async function cancel(op: 'fetch' | 'pull' | 'push'): Promise<void>             // AC-45
```

**Quan hệ với store khác:**
- `workspace`: khi `engine` complete một phase, engine emit event qua IPC; store `workspace` listen + dispatch `git.fetchStatus()` (debounced) để cập nhật badge dirty và history.
- `settings`: đọc flag `autoCommitPerPhase`, `dirtyTaskPolicy` (`warn` / `auto-stash`), `autoFetchIntervalMs`.
- `sessions`: không trực tiếp; sessions chat agent có thể trigger artifact write — nhưng commit do engine handle, không session.

**Optimistic update:**
- `stageFile` / `unstageFile`: cập nhật `status.files[*].stageState` ngay trên client, gọi IPC, nếu fail → rollback + toast.
- `commit`: KHÔNG optimistic (commit là mutation lớn, đợi sidecar trả sha mới).
- `branchCheckout`: optimistic switch tên branch, fail rollback.

## Sidecar IPC contract

> Các method liệt kê dưới đây là **contract level UI ↔ sidecar**, không phải spec implementation. Tech Lead sẽ refine trong ADR (granularity, error envelope, streaming protocol).

### Convention chung

- **JSON-RPC 2.0** trên stdio (theo [ADR 0008](../decisions/0008-stdio-ipc-for-sidecar.md)).
- Mỗi method tham số được validate qua zod ở sidecar (defense in depth — UI cũng validate).
- Tất cả method spawn `git` với `cwd = workspaceRoot` (security invariant #3).
- Tất cả arg pass qua **arg array**, không shell string (security: cmd injection).
- Error envelope (gợi ý):
  ```ts
  {
    code: 'OK' | 'BUSY' | 'DIRTY_TREE' | 'NOT_FAST_FORWARD' | 'MERGE_CONFLICT'
        | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'WORKSPACE_NOT_FOUND'
        | 'REMOTE_NOT_FOUND' | 'UNMERGED' | 'FILE_LOCKED' | 'GIT_NOT_FOUND'
        | 'UNKNOWN'
    message: string             // sanitized, hiển thị UI
    stderrSanitized?: string    // optional, có thể show trong modal lỗi
  }
  ```
- Streaming event prefix `git:*:progress` qua channel event riêng (xem [ADR 0008](../decisions/0008-stdio-ipc-for-sidecar.md)).

### Methods

> **Ngoại lệ contract:** `git.discoverRepos` (xem [Multi-repo trong project](#multi-repo-trong-project)) **không** nhận `workspaceRoot` mà nhận `root` (folder project, có thể không phải repo). Đây là method duy nhất chạy *trước* khi biết repo, nên không qua mutex/`assertWorkspace` của git runner — chỉ là walk filesystem read-only, không spawn git.

#### Read

```ts
// git.discoverRepos — quét folder project tìm các git repo (tối đa 2 cấp)
input:  { root: string }   // absolute path của folder project (container)
output: { repos: GitRepoEntry[] }   // root-repo trước, rồi theo relativePath
git:    (không spawn git — chỉ stat `.git` + readdir, bỏ qua SKIP_DIRS)

// git.status — list working tree status
input:  { includeIgnored?: boolean }  // default false
output: GitStatus
git:    `git status --porcelain=v2 -z --branch [--ignored]`

// git.log — list commit history
input:  { limit: number; skip?: number; ref?: string; path?: string }
output: { commits: GitCommit[]; hasMore: boolean }
git:    `git log --pretty=format:%H%x00%h%x00%an%x00...%x00 -z -n <limit> [--skip=<n>] [<ref>] [-- <path>]`

// git.diff — diff cho file uncommitted hoặc commit cụ thể
input:
  | { kind: 'workingTree'; path?: string }                       // diff working vs index
  | { kind: 'staged';      path?: string }                       // diff index vs HEAD
  | { kind: 'commit';      sha: string }                         // diff commit vs parent
  | { kind: 'commitRange'; from: string; to: string }
output: GitDiff
git:    tương ứng `git diff [--cached] [-- <path>]` / `git show <sha>`

// git.branchList
input:  {}
output: { branches: GitBranch[] }
git:    `git for-each-ref --format=... refs/heads refs/remotes`

// git.stashList
input:  {}
output: { stashes: GitStashEntry[] }
git:    `git stash list --format=...`

// git.remoteList
input:  {}
output: { remotes: GitRemote[] }
git:    `git remote -v`

// git.readConflictFile — parse file conflicted
input:  { path: string }
output: GitMergeConflictFile
git:    đọc file qua FS, parse marker <<<<<<< === >>>>>>>
```

#### Mutate (synchronous, < 1s)

```ts
// git.stageFile
input:  { paths: string[] }
output: { ok: true }
git:    `git add -- <paths...>`

// git.unstageFile
input:  { paths: string[] }
output: { ok: true }
git:    `git restore --staged -- <paths...>` (fallback `git reset HEAD -- <paths...>`)

// git.stageHunk
input:  { path: string; hunkIndex: number }   // hunkIndex tham chiếu từ GitFileDiff.hunks
output: { ok: true }
implementation: build patch chỉ chứa hunk → `git apply --cached -` từ stdin

// git.discardFile
input:  { paths: string[] }
output: { ok: true }
git:    `git checkout -- <paths...>` (fallback `git restore <paths>`)

// git.commit
input:  { message: string; amend?: boolean; signoff?: boolean }
output: { sha: string; sha7: string }
git:    `git commit [--amend] [-s] -m <message>` (multi-line: `-F -` stdin)

// git.branchCreate
input:  { name: string; from: string; checkout: boolean }
output: { ok: true }
git:    `git checkout -b <name> [<from>]` hoặc `git branch <name> [<from>]`

// git.branchCheckout
input:  { name: string; force?: boolean }
output: { ok: true } | { code: 'DIRTY_TREE', files: GitFileStatus[] }
git:    `git checkout [-f] <name>`

// git.branchDelete
input:  { name: string; force: boolean }
output: { ok: true } | { code: 'UNMERGED' }
git:    `git branch -d` / `git branch -D`

// git.stashSave
input:  { message: string; includeUntracked: boolean }
output: { ok: true; index: number }
git:    `git stash push [-u] -m <message>`

// git.stashPop
input:  { index: number }
output: { ok: true; hasConflict: boolean }
git:    `git stash pop stash@{<index>}`

// git.stashDrop
input:  { index: number }
output: { ok: true }
git:    `git stash drop stash@{<index>}`

// git.resolveFile
input:  { path: string; resolutions: GitConflictResolution[] }
output: { ok: true }
implementation: parse file, thay block theo resolutions, ghi đè file, `git add -- <path>`

// git.mergeAbort
input:  {}
output: { ok: true }
git:    `git merge --abort`

// git.completeMerge
input:  { message?: string }
output: { sha: string }
git:    `git commit [-m <message>] [--no-edit]`

// git.checkoutFileAtCommit
input:  { path: string; ref: string }
output: { ok: true }
git:    `git checkout <ref> -- <path>`

// git.init — chỉ dùng khi workspace chưa init
input:  {}
output: { ok: true }
git:    `git init && git config core.autocrlf <platform default>`
```

#### Mutate (async, streaming progress)

```ts
// git.fetch
input:  { remote?: string; prune?: boolean }  // default remote=undefined → all
output: { ok: true; updated: { ref: string; oldSha: string; newSha: string }[] }
events: 'git:fetch:progress' { phase: 'connecting' | 'receiving' | 'resolving'; pct: number | null }
git:    `git fetch --progress [--all|--prune] [<remote>]`

// git.pull
input:  { strategy: 'ff-only' | 'merge' | 'rebase' }
output: { ok: true; fastForwarded: boolean; commitsApplied: number }
        | { code: 'NOT_FAST_FORWARD' }
        | { code: 'MERGE_CONFLICT', files: string[] }
events: 'git:pull:progress' { phase, pct }
git:    `git pull --progress [--ff-only|--no-rebase|--rebase] origin <branch>`

// git.push
input:  { remote?: string; branch?: string; setUpstream?: boolean }
output: { ok: true; pushed: number }
        | { code: 'AUTH_FAILED', hint: 'ssh-key'|'https-token'|'unknown' }
        | { code: 'NOT_FAST_FORWARD' }
events: 'git:push:progress' { phase, pct }
git:    `git push --progress [--set-upstream] [<remote>] [<branch>]`

// git.cancel — hủy operation đang chạy
input:  { op: 'fetch' | 'pull' | 'push' }
output: { ok: true }
implementation: gửi SIGTERM tới process git đang spawn cho op tương ứng
```

### Streaming events (sidecar → UI, không có request)

```ts
// Phát khi mutation xong, UI auto-refresh status
'git:status:changed' { reason: 'commit' | 'stage' | 'unstage' | 'pull' | 'merge' | 'stash' | 'checkout' | 'external' }

// External change detection: sidecar dùng chokidar watch .git/index để detect git ops từ CLI ngoài
// (out of scope MVP? — xem Open Question OQ-7)

// Auto-fetch event nếu Engine triggered
'git:auto-fetch:done' { updated: number }
```

## Workspace dirty policy

**Quyết định BA (chốt với user):** **warn (không block)** mặc định.

- NavRail Git icon hiển thị **dot indicator** màu `t.warning` khi `isDirty === true`.
- Khi user tạo task mới, **modal warning** nếu dirty:
  - Copy: "Workspace có change uncommitted. Recommend commit hoặc stash trước khi chạy task để tránh trộn change của user với change của agent."
  - 3 nút: **Commit changes** (deeplink `/git`) / **Stash & continue** (sequence auto-stash + start task) / **Continue anyway** (warn-suppress).
  - Toggle "Đừng hỏi lại trong session này" (giữ trong session memory, không persist).
- Settings → Workspace có option **"Auto-stash dirty tree before task"** = OFF mặc định. ON = skip modal, tự stash trước mỗi task. Stash message format: `awog-auto-stash before task <task-id>`.
- KHÔNG có "block hard" — user vẫn quyết định.

**Lý do chọn warn:**
- KISS: không cản trở user power-user.
- Local-first: user là solo builder, có quyền tự quyết.
- Trace-friendly: nếu user "Continue anyway" → trace event ghi `task.started_dirty: true` để debug sau.

## Auto-commit per phase

**Quyết định BA:** tích hợp ở Task Execution Engine, opt-in mặc định **ON**.

### Trigger

- Khi Engine hoàn tất một phase (transition `running → completed` hoặc `running → waiting_approval`):
  1. Engine gọi nội bộ `git.diff { kind: 'workingTree' }` để check có thay đổi không.
  2. Nếu có thay đổi → gọi `git.commit` với template message.
  3. Nếu không có thay đổi → skip, log "No changes for phase X".

### Message template

- **Default:** `[<phaseId>] <agentName>: <skillName-summary>`.
- Ví dụ: `[N_arch] Solution Architect: design partitioned scheduler`.
- `<summary>` = output từ skill (1 dòng đầu của artifact chính, lower-case, truncate 60 ký tự) HOẶC field summary từ phase nếu agent emit explicit.
- **User customizable** qua Settings → Workspace → "Commit message template". Field thay thế support:
  - `{phaseId}`, `{agentName}`, `{agentRole}`, `{skillName}`, `{taskId}`, `{taskTitle}`, `{summary}`, `{timestamp}`.

### Scope

- **MVP:** commit toàn bộ workspace (`git add -A` rồi `git commit`).
  - Lý do: simple, đúng tinh thần KISS; ràng buộc: nếu user có change uncommitted ngoài ý đồ agent, sẽ bị trộn vào commit của phase. Mitigation: kết hợp với "Auto-stash dirty tree before task" để chỉ commit change của agent.
- **Settings option:** "Commit scope" (radio):
  - `workspace` (default) — `git add -A`.
  - `artifacts-only` — chỉ `git add workspace/tasks/<taskId>/artifacts/` (phải biết scope artifact của phase). Phức tạp hơn — out of scope v1 nếu không kịp; ghi nhận open question OQ-3.

### Setting fields

`apps/desktop/ui/stores/settings.ts` thêm:

```ts
interface WorkspaceSettings {
  // ...
  autoCommitPerPhase: boolean                          // default true
  autoCommitMessageTemplate: string                    // default '[{phaseId}] {agentName}: {summary}'
  autoCommitScope: 'workspace' | 'artifacts-only'      // default 'workspace'
  autoStashDirtyBeforeTask: boolean                    // default false
  dirtyTaskPolicy: 'warn' | 'auto-stash' | 'block'     // default 'warn' — 'block' giữ cho enterprise sau
  autoFetchIntervalMs: number                          // default 300000 (5 phút); 0 = tắt
}
```

### Trace integration

- Mỗi auto-commit append event vào `events.log`:
  ```ts
  {
    type: 'artifact.commit',
    taskId, phaseId, runVersion,
    commitSha: '<full-sha>',
    commitSha7: '<sha7>',
    message: '<template-filled>',
    scope: 'workspace' | 'artifacts-only',
    at: ISO,
  }
  ```
- UI `agent-trace.md` tab Execution hiển thị một trace node `commit` mới (kind `tool`, name `git.commit`, result `<sha7>`) — sau cùng trong sequence của phase.
- Cross-link 2 chiều:
  - Phase detail → "View commit" → `/git?tab=history&commit=<sha>`.
  - Commit trong `GitHistoryList` (parse `[phaseId]`) → "Open phase" → `/tasks/<taskId>#phase=<phaseId>`.

## Conflict resolver UI v1

### Phạm vi

- **2-way pick** per conflict block: ours / theirs (mutually exclusive).
- KHÔNG có manual edit text inline ở v1 (user muốn edit → "Open in external editor" — out of scope; fallback: dùng artifact markdown editor mở file).
- Cho phép 1 file có nhiều block, mỗi block chọn riêng.
- Hỗ trợ "Take all ours" / "Take all theirs" ở header file.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Header: <path>      [Take all ours] [Take all theirs]          │
│                      [Mark resolved] (disabled until all chosen)│
├─────────────────────────────────────────────────────────────────┤
│  Block 1 of 3 — line 12                                         │
│  ┌─────────────────────────────┬─────────────────────────────┐  │
│  │ OURS (HEAD)                 │ THEIRS (origin/main)        │  │
│  │ <Monaco diff readonly>      │ <Monaco diff readonly>      │  │
│  │ [Take ours]                 │ [Take theirs]               │  │
│  └─────────────────────────────┴─────────────────────────────┘  │
│  Block 2 of 3 — line 45                                         │
│  ...                                                            │
└─────────────────────────────────────────────────────────────────┘
```

- Dùng Monaco diff editor mode `readonly` cho 2 pane (đã có Monaco trong stack).
- Block đã chọn highlight border màu `t.accent`; chưa chọn = `t.border`.
- "Mark resolved" enable khi tất cả block có lựa chọn.

### Khi click "Mark resolved"

- Gọi `git.resolveFile { path, resolutions: [{ blockIndex: 0, choice: 'ours' }, ...] }`.
- Sidecar:
  1. Đọc lại file (defense in depth — không trust resolutions UI tính sẵn).
  2. Parse marker.
  3. Với mỗi block, thay nội dung block bằng `ours` hoặc `theirs` text (giữ nguyên line ending của file).
  4. Ghi đè file.
  5. `git add -- <path>`.

### Binary conflict

- `GitMergeConflictFile.isBinary === true` → UI hiển thị 2 button file-level: "Take ours (binary)" / "Take theirs (binary)".
- Sidecar gọi `git checkout --ours -- <path>` hoặc `git checkout --theirs -- <path>` rồi `git add`.

## Auth strategy

**Quyết định BA (chốt với user):** MVP **dựa hoàn toàn** vào git config sẵn của OS.

- AWOG **không lưu credential** (SSH key, HTTPS token).
- AWOG **không expose** credential field trong Settings.
- Sidecar khi spawn `git push/pull/fetch` → để Git tự dùng:
  - SSH agent (env `SSH_AUTH_SOCK`).
  - Git credential helper (`osxkeychain`, `manager-core`, `cache`).
- Khi auth fail:
  - Sidecar parse stderr (sanitize — không log raw token):
    - Chứa "Permission denied (publickey)" → `hint = 'ssh-key'`.
    - Chứa "Authentication failed" + URL HTTPS → `hint = 'https-token'`.
    - Else → `hint = 'unknown'`.
  - Trả `{ code: 'AUTH_FAILED', hint, stderrSanitized }`.
  - UI hiển thị modal `GitAuthErrorModal` với copy hướng dẫn theo hint.
  - **Không** prompt nhập credential trong AWOG. User phải fix ngoài rồi retry.

**Security:**
- `git` process inherit env từ sidecar (chỉ pass `PATH`, `HOME`, `SSH_AUTH_SOCK`, không pass biến nhạy cảm khác).
- KHÔNG log credential trong trace event.
- KHÔNG export credential qua IPC.

## Performance budget

| Operation | Budget | Notes |
|---|---|---|
| `git.status` (repo ≤ 2k file) | **< 200ms** end-to-end | AC-43. Đo từ UI dispatch → render xong. |
| `git.status` (repo > 10k file) | < 1s | AC-44. Virtual scroll bắt buộc. |
| `git.diff` cho 1 file | < 100ms parse + render | Monaco render diff incremental. |
| `git.log` limit 100 | < 500ms | Initial load tab History. |
| `git.fetch` | network-bound | Streaming progress, UI không block. |
| Auto-fetch interval | **5 phút mặc định** (ON) | Chỉnh / tắt (0) ở Settings → Workspace. |
| Status auto-refresh | Debounce 200ms khi nhận `git:status:changed` event | Tránh thrash khi user spam stage/unstage. |
| Render `GitStatusList` | < 16ms per scroll frame (60fps) | Virtual scroll cho > 200 row. |
| `git.commit` | < 500ms (commit nhỏ) | Bigger commit (>1k file) có thể chậm — chấp nhận. |

**Auto-fetch (background):** trang `/git` chạy `fetchRemote(silent)` ngay khi mở, lặp lại mỗi `autoFetchIntervalMs` (default 300000ms = 5 phút), và fetch lại khi cửa sổ focus lại. Silent = không toast, không progress strip, lỗi (offline/auth) nuốt im; vẫn refresh branches/status để ahead/behind của main/develop/release luôn tươi. Bỏ qua khi đang busy hoặc tab ẩn. Wiring ở [`pages/git/index.vue`](../../apps/desktop/ui/pages/git/index.vue) + flag `silent` trong `fetchRemote` ([stores/git.ts](../../apps/desktop/ui/stores/git.ts)). Đặt interval = 0 để tắt.

**Strategy:**
- Parse output Git ở sidecar (Node.js), gửi UI **structured JSON** (không stream raw).
- Cache `branches` / `remotes` 5s (vì ít đổi).
- Status KHÔNG cache (luôn fresh).
- Diff: cache 1 entry hiện tại; switch file → flush.

## Security

8 invariant AWOG áp dụng (xem [.claude/rules/security.md](../../.claude/rules/security.md)):

- **#3 Git scope = workspace** ✓ — mọi `git` spawn `cwd = workspaceRoot`; KHÔNG dùng `git -C` từ payload UI.
- **#4 IPC boundary** ✓ — UI KHÔNG `import child_process` hay gọi `git` trực tiếp; tất cả qua IPC.
- **#2 Path sanitize** ✓ — mọi path từ UI validate ở sidecar: `path.resolve(workspaceRoot, userPath)`, check `startsWith(workspaceRoot)`, reject `..` literal, reject symlink ra ngoài.
- **#1 API key isolation** — không áp dụng trực tiếp (Git Manager không dùng model API), nhưng auth strategy không bao giờ log credential.
- **#8 No eval / dynamic require** ✓ — commit message hiển thị plain text, không render markdown trong commit list (tránh XSS).

**Cụ thể:**

| Sink | Risk | Mitigation |
|---|---|---|
| `execFile('git', [...])` | Cmd injection | **Arg array luôn**; KHÔNG dùng `exec`/`spawn` với shell string. Validate subcommand qua allowlist (chỉ allow `status`, `add`, `commit`, `log`, `diff`, `fetch`, `pull`, `push`, `branch`, `checkout`, `stash`, `merge`, `restore`, `reset`, `apply`, `init`, `remote`, `show`, `for-each-ref`, `config`). |
| Path từ UI (file stage, file diff) | Path traversal | Validate startsWith(workspaceRoot); reject symlink. |
| Commit message từ UI | XSS / log injection | Render `GitHistoryList` qua text node, KHÔNG `v-html`. Sidecar pass message qua `-F -` stdin nếu chứa newline. |
| stderr parsing | Verbose leak (token in URL) | Sanitize regex strip token in URL (`https://user:TOKEN@host` → `https://user:***@host`); strip request ID. |
| Conflict resolver — overwrite file | TOCTOU | Sidecar lock file via `flock` (Linux/macOS) hoặc atomic rename (Windows) khi ghi resolved content. |
| Branch name từ UI | Cmd-arg quirks | Validate regex Git ref name; reject `..`, `@{`, `~`, `^`, `:`, `?`, `*`, `[`, `\\`, control chars. |

**Trust level:**

- User input ở UI (commit message, branch name, path click) → **L1**, validate ở UI + sidecar.
- Output Git (stderr, stdout) → **L1** (Git có thể trả từ remote untrusted), parse vào schema có shape kiểm soát.
- Settings `autoCommitMessageTemplate` → **L2** (đã qua schema validate ở settings store).

## Dependencies & sequence

### Phải có trước Git Manager

1. **Sidecar shell skeleton** với IPC bus (stdio JSON-RPC) — đang chờ wire ([ADR 0008](../decisions/0008-stdio-ipc-for-sidecar.md)). Git Manager KHÔNG implement được nếu chưa có IPC layer.
2. **Workspace path resolved** trong settings — đã có (`stores/settings.ts`).
3. **Theme tokens cho diff** — đã có (Artifact System đã định nghĩa `diffAdded`/`diffRemoved`); chỉ cần bổ sung `diffOurs`/`diffTheirs` cho Conflict Resolver (cần Designer/TL confirm).
4. **Diff renderer reusable component** — đã có trong Artifact System (`.diff`/`.patch` viewer); refactor thành component dùng chung `GitDiffViewer`.

### Phụ thuộc vào Git Manager

1. **Auto-commit per phase** (Task Execution Engine) — phải có `git.commit` IPC trước.
2. **Cross-link commit ↔ phase** (Agent Trace) — phải có `git.log` parsing để render link.
3. **Rerun-from-here với rollback an toàn** (Human Approval) — phải có `git.checkoutFileAtCommit` hoặc tương đương để revert artifact downstream.
4. **Resume task sau restart** (Task Execution Engine) — kiểm tra `git.status` trước khi resume để cảnh báo nếu workspace dirty từ session trước.
5. **NavRail dirty badge** — UI dependency.

### Implementation order đề xuất (cho PM)

1. **Phase 1 (foundation, M):** types + Pinia store skeleton + IPC contract spec ADR (TL viết) + sidecar handler cho 5 method read (`status`, `log`, `diff`, `branchList`, `stashList`).
2. **Phase 2 (Changes tab, M):** `GitStatusList` + `GitDiffViewer` + `GitCommitPanel` + IPC mutation (stage, unstage, commit, discard).
3. **Phase 3 (History + Branches, M):** `GitHistoryList` + `GitBranchList` + branch ops.
4. **Phase 4 (Remote ops, M):** Fetch + Pull + Push với streaming progress + `GitAuthErrorModal`.
5. **Phase 5 (Stash + Conflict, L):** `GitStashList` + `GitConflictResolver` + merge flow.
6. **Phase 6 (Integration, M):** Auto-commit per phase + cross-link trace + dirty policy modal + NavRail badge.
7. **Phase 7 (Polish, S):** stage hunk, amend, virtual scroll, performance tuning.

## Open questions cho Tech Lead

> Các câu này cần TL trả lời trong ADR trước khi PM decompose task.

| ID | Câu hỏi | Đề xuất phương án |
|---|---|---|
| OQ-1 | **Granularity IPC**: 1 method per Git command (như spec hiện) hay grouped `git.exec { subcommand, args }`? | A. Per-command (typed, an toàn) — khuyến nghị. B. Grouped (linh hoạt, risk cmd injection). |
| OQ-2 | **Streaming protocol cho progress**: dùng JSON-RPC notifications (`{ method, params }` không có `id`) hay channel riêng (event bus)? | Khuyến nghị notifications cùng channel để giảm bề mặt API. |
| OQ-3 | **Auto-commit scope `artifacts-only`**: có implement ở v1 hay defer? | Defer v2; v1 chỉ `workspace`. |
| OQ-4 | **Cancellation semantics**: SIGTERM có đủ để dừng `git push` giữa chừng? Có nên kèm SIGKILL sau timeout? | TERM trước, KILL sau 2s nếu không exit. |
| OQ-5 | **External git ops detection**: nếu user dùng CLI `git` từ terminal khác trong cùng workspace, UI có auto-refresh không? Chokidar watch `.git/HEAD` + `.git/index`? | Khuyến nghị có (chokidar watch nhẹ); nếu phức tạp → defer v2, có button "Refresh" thủ công. |
| OQ-6 | **Conflict resolver — encoding**: file UTF-8 đảm bảo OK; file encoding khác (UTF-16, Shift_JIS)? | v1 yêu cầu UTF-8; phát hiện encoding khác → hiển thị warning "Encoding không support, mở external editor". |
| OQ-7 | **Mutex per workspace**: implement trong sidecar (in-memory queue) hay `.git/index.lock` của Git là đủ? | Khuyến nghị queue in-memory cho UX feedback (BUSY error) + Git lock là defense in depth. |
| OQ-8 | **Bundle Git binary** hay yêu cầu user cài? | Yêu cầu user cài (giảm size Tauri); detect lúc bootstrap; banner hướng dẫn nếu missing. Brief Q. |
| OQ-9 | **`gitnexus` semantic search**: liên quan gì tới Git Manager không? | Không — gitnexus là context provider (đọc code semantic), Git Manager chỉ thao tác `.git/`. Tách biệt hoàn toàn. |
| OQ-10 | **Theme token cho conflict resolver**: thêm `diffOurs` / `diffTheirs` vào `utils/themes.ts`? | Yes, cần Designer chốt hex cho dark + light. |
| OQ-11 | **Hỗ trợ commit message multi-line edit**: textarea plain hay Monaco với git-commit syntax highlight? | Plain textarea cho v1 (KISS); Monaco cho v2 nếu user feedback cần. |
| OQ-12 | **Force push** có expose không? | Không ở v1 (DANGEROUS); user dùng CLI. Brief đã loại reset/rebase, mở rộng cùng nguyên tắc. |

## Test scenarios (input cho QA)

- **TS-1 (happy stage+commit):** Tạo file mới, mở /git → file ở Untracked → stage → commit "test" → History có commit mới.
- **TS-2 (hunk):** Edit file 3 chỗ, mở diff → stage hunk #2 → check `git diff --cached` chỉ chứa hunk #2.
- **TS-3 (discard):** Edit file → discard → file revert về HEAD.
- **TS-4 (amend):** Commit → edit file → amend last commit → sha thay đổi, message giữ.
- **TS-5 (fetch):** Tạo commit ở remote (qua CLI) → click Fetch → ahead/behind cập nhật.
- **TS-6 (pull ff):** Behind 1 → Pull → toast "Pulled 1 commit (fast-forward)".
- **TS-7 (pull diverge):** Diverge → Pull ff-only fail → modal Merge/Rebase.
- **TS-8 (pull conflict):** Pull → merge conflict → auto-mở Conflict Resolver.
- **TS-9 (push happy):** Commit → Push → toast "Pushed 1 commit".
- **TS-10 (push auth fail):** Disable SSH agent → Push → modal "SSH key" hint.
- **TS-11 (push non-ff):** Remote có commit chưa pull → Push → modal "Pull then push".
- **TS-12 (stash save/pop):** Dirty → Stash save → workspace clean → Pop → file trở lại.
- **TS-13 (stash pop conflict):** Dirty branch A → stash → switch B → edit cùng file → switch A → pop → conflict.
- **TS-14 (branch create):** New branch "feature/test" → checkout → current = "feature/test".
- **TS-15 (branch invalid name):** New branch "feature with space" → UI inline error.
- **TS-16 (branch checkout dirty):** Dirty → checkout other → modal Stash & checkout.
- **TS-17 (branch delete merged):** Delete merged branch → ok.
- **TS-18 (branch delete unmerged):** Delete unmerged → confirm "Force delete?".
- **TS-19 (conflict resolve):** Merge conflict → resolver mở → chọn ours/theirs cho từng block → Mark resolved → Commit merge.
- **TS-20 (conflict binary):** Binary conflict → take ours file-level → workspace OK.
- **TS-21 (auto-commit ON):** Setting ON → start task → phase done → History có commit `[N_arch] Architect: ...`.
- **TS-22 (auto-commit OFF):** Setting OFF → phase done → workspace dirty, no commit.
- **TS-23 (cross-link):** Click commit `[N_arch]` trong History → block "Linked phase" → click → navigate task detail phase.
- **TS-24 (dirty warn task):** Dirty → start task → modal warn → "Stash & continue" → task chạy, stash hiện trong tab Stash.
- **TS-25 (detached HEAD):** Checkout commit từ History → banner "DETACHED at <sha7>" → commit prompts "Create branch?".
- **TS-26 (empty repo):** Workspace mới `git init` → empty state History; Changes tab cho commit đầu.
- **TS-27 (no git init):** Workspace chưa `git init` → empty state với CTA "Initialize Git repo".
- **TS-28 (no git binary):** Uninstall Git → restart AWOG → banner full-page.
- **TS-29 (offline):** Disable network → Fetch → toast "Mạng không khả dụng".
- **TS-30 (remote not found):** Xóa `origin` qua CLI → Push → modal "Remote 'origin' không tồn tại".
- **TS-31 (large repo status):** Repo 15k file → status < 1s → virtual scroll mượt.
- **TS-32 (cancel push):** Long push → Cancel → revert.
- **TS-33 (security path traversal):** Hack UI gọi `git.diff { path: '../../etc/passwd' }` → sidecar reject `INVALID_PATH`.
- **TS-34 (security cmd injection):** Branch name "a; rm -rf /" → UI block; sidecar block; spawn arg array không chạy được command thứ 2.
- **TS-35 (concurrent commit):** User click Commit ngay khi auto-commit phase đang chạy → 1 trong 2 nhận `BUSY` → retry queue 5s.
- **TS-36 (path unicode):** File "あ.md" → stage / commit / diff đúng.
- **TS-37 (file lock Windows):** Open file in Word → discard → toast "File <path> đang bị lock".
- **TS-38 (CRLF/LF):** Workspace `core.autocrlf=true`, edit file Windows → commit → diff hiển thị badge "CRLF→LF" nếu Git renormalize.
- **TS-39 (rename detection):** Rename `a.md` → `b.md` + edit → diff hiển thị "renamed: a.md → b.md" với hunk thay vì 2 entries add/delete.
- **TS-40 (workspace moved):** Khi đang mở app, move workspace folder ra chỗ khác → next `git.status` → modal "Workspace folder không tồn tại".

## Tham chiếu

- [git-manager.brief.md](./git-manager.brief.md) — feature brief gốc
- [artifact-system.md](./artifact-system.md) — diff viewer tái dùng
- [task-execution-engine.md](./task-execution-engine.md) — auto-commit per phase, status lifecycle
- [agent-trace.md](./agent-trace.md) — cross-link commit ↔ phase, trace event `artifact.commit`
- [human-approval.md](./human-approval.md) — revert per file là approval action
- [settings.md](./settings.md) — workspace settings bổ sung (autoCommit fields)
- [connection-quota-handling.md](./connection-quota-handling.md) — mẫu spec tham chiếu (state transition + IPC contract)
- [docs/architecture/system-overview.md](../architecture/system-overview.md) — sidecar boundary
- [docs/architecture/data-model.md](../architecture/data-model.md) — entity Task / Phase / Run
- [docs/architecture/execution-model.md](../architecture/execution-model.md) — lifecycle Task
- [docs/requirements/mvp-scope.md](../requirements/mvp-scope.md) — dòng "Versioning bằng Git"
- [.claude/rules/security.md](../../.claude/rules/security.md) — invariant #3 (Git scope), #4 (IPC boundary), #2 (path sanitize)
- [apps/desktop/ui/types/index.ts](../../apps/desktop/ui/types/index.ts) — types bổ sung
- [apps/desktop/ui/stores/workspace.ts](../../apps/desktop/ui/stores/workspace.ts) — store hiện hữu
- [apps/desktop/ui/stores/settings.ts](../../apps/desktop/ui/stores/settings.ts) — settings bổ sung
