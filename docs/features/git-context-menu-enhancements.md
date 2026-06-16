# Feature: Git Branch Context-Menu Enhancements

**Trạng thái:** Draft
**Owner:** Business Analyst
**Ngày tạo:** 2026-06-16
**Tham chiếu:** [git-manager.md](./git-manager.md), [ADR 0017 — Git Manager IPC contract](../decisions/0017-git-manager-ipc-contract.md)

## Mục lục

- [Overview](#overview)
- [Hiện trạng](#hiện-trạng)
- [Scope](#scope)
- [Out of scope](#out-of-scope)
- [Chi tiết từng chức năng](#chi-tiết-từng-chức-năng)
  - [1. Ahead/behind per branch (count pull/push)](#1-aheadbehind-per-branch-count-pullpush)
  - [2. Create tag từ branch](#2-create-tag-từ-branch)
  - [3. Merge into current](#3-merge-into-current)
  - [4. Rebase current onto branch](#4-rebase-current-onto-branch)
  - [5. Create PR (mở browser)](#5-create-pr-mở-browser)
- [Sidecar IPC contract](#sidecar-ipc-contract)
- [UI changes](#ui-changes)
- [Conflict handling](#conflict-handling)
- [Security](#security)
- [i18n](#i18n)
- [Acceptance Criteria](#acceptance-criteria)
- [Edge cases](#edge-cases)
- [Open questions](#open-questions)

## Overview

Context menu branch trong sidebar Git hiện chỉ có **Checkout / New branch from here / Rename / Copy name / Delete branch**. Spec này bổ sung các thao tác branch còn thiếu để Git Manager ngang một Git client (Fork/Sublime Merge): **Merge, Rebase, Create tag, Create PR**, và làm rõ **hiển thị count pull/push** (ahead/behind) cho từng branch.

Tất cả bám đúng các invariant của [git-manager.md](./git-manager.md): mọi `git.*` spawn với `cwd = workspaceRoot` (effective git root), mutex per workspace, conflict route vào `GitConflictResolver` đã có.

## Hiện trạng

| Chức năng | Hiện trạng | Việc cần làm |
|---|---|---|
| **Ahead/behind per branch** | Data có sẵn (`branch.ahead`/`branch.behind` từ `git.branchList`); tree **đã render** `↑N ↓N` cho mọi local branch ([GitBranchTree.vue:67-74](../../apps/desktop/ui/components/git/GitBranchTree.vue#L67-L74)) | Chuẩn hoá badge theo convention (12px font-mono pill), đưa hint vào menu, đảm bảo freshness sau fetch |
| **Create tag** | `git.tagCreate` + `GitTagCreateModal` đã có, đang dùng ở History ([GitHistoryTable.vue:179](../../apps/desktop/ui/components/git/GitHistoryTable.vue#L179)) | Thêm entry menu → mở modal tạo tag tại tip của branch |
| **Merge** | Chưa có `git.merge` (chỉ có `merge-abort` / `complete-merge`) | Thêm method mới + entry menu |
| **Rebase** | Chưa có `git.rebase` | Thêm method mới (non-interactive) + entry menu |
| **Create PR** | Chưa có hạ tầng | Parse remote URL → mở compare URL bằng `openExternal` |

## Scope

5 enhancement trên menu branch. Menu phân nhánh theo loại branch:

- **Local, không phải current:** Checkout · New branch from here · **Merge into `<current>`** · **Rebase `<current>` onto this** · Rename · **Create tag…** · **Create pull request** · Copy name · Delete branch.
- **Local, là current:** Checkout (disabled) · New branch from here · Rename · **Create tag…** · **Create pull request** · Copy name · Delete (disabled). *(Merge/Rebase chính nó vào chính nó vô nghĩa → ẩn.)*
- **Remote:** Checkout as local · Fetch · **Merge into `<current>`** · **Create pull request** · Copy name. *(Rename/Delete/Rebase remote: out of scope.)*

## Out of scope

- Interactive rebase (`rebase -i`, reorder/squash/edit) — chỉ làm `git rebase <upstream>` thẳng.
- Tạo PR **trong app** (gh CLI / GitHub API) — đã chốt dùng browser compare URL ([AskUserQuestion 2026-06-16]).
- Merge với chọn strategy nâng cao (`-X ours/theirs`, octopus) — chỉ default merge (tôn trọng fast-forward).
- Delete remote branch, push tag — kế thừa scope hiện tại.

## Chi tiết từng chức năng

### 1. Ahead/behind per branch (count pull/push)

**Đã có:** `git.branchList` parse `%(upstream:track)` → `ahead`/`behind` cho mỗi local branch; tree hiển thị `↑N ↓N`.

**Cải thiện:**
- Badge `↑N`/`↓N` đổi sang **`text-[12px] font-mono leading-none`** theo [nuxt-vue.md UI patterns](../../.claude/rules/nuxt-vue.md) (status hint inline = 12px fixed, không scale theo `--font-size-base`). Hiện đang `text-[1em]`.
- `↑` (ahead) = commit local **chưa push**; `↓` (behind) = commit remote **chưa pull**. Tooltip rõ nghĩa: `tr('git.branches.ahead_behind_hint', { ahead, behind })`.
- Trong context menu của current branch, thêm 2 entry **Pull (`↓N`)** và **Push (`↑N`)** (đã có `store.pull`/`store.push`) với count inline, disabled khi count = 0 hoặc không có upstream.
- **Freshness:** ahead/behind chỉ đúng tới lần fetch gần nhất. Auto-fetch (5') đã có; không thay đổi. Ghi chú tooltip "relative to last fetch".

### 2. Create tag từ branch

Tái sử dụng `GitTagCreateModal` + `store.createTag(name, sha, opts)`. Menu "Create tag…" → mở modal với `targetSha = branch.lastCommitSha` (đã có trong `GitBranch`), prefill nhãn branch để user biết tag tại đâu. Không cần method sidecar mới.

### 3. Merge into current

- Entry: **"Merge `<branchName>` into `<currentBranch>`"** (chỉ hiện khi `!isCurrent`).
- Method mới `git.merge` (xem [IPC contract](#sidecar-ipc-contract)). Default merge (cho phép fast-forward). Conflict → envelope `MERGE_CONFLICT` → route vào Conflict Resolver (giống cherry-pick).
- Sau merge thành công: toast + refresh status/branches. Khi đang dirty → chặn trước (đã có `GitDirtyCheckoutModal` pattern / kiểm tra `store.isDirty`), yêu cầu commit/stash.

### 4. Rebase current onto branch

- Entry: **"Rebase `<currentBranch>` onto `<branchName>`"** (chỉ hiện khi `!isCurrent`, local branch).
- Method mới `git.rebase` — chạy `git rebase <onto>` (non-interactive). Conflict → envelope `MERGE_CONFLICT` (+ flag `rebase: true` để Conflict Resolver gọi `git rebase --continue` thay vì commit khi resolve xong; abort = `git rebase --abort`).
- **Lưu ý lifecycle:** `completeMerge`/`mergeAbort` hiện cứng cho merge. Cần tổng quát hoá: state `conflicts.ts` ghi `operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert'` để chọn đúng lệnh continue/abort. (Hiện cherry-pick/revert cũng route vào resolver nhưng dùng commit thường — cần xác nhận với TL cách finalize.)
- Cảnh báo dirty như merge.

### 5. Create PR (mở browser)

- Entry: **"Create pull request"** trên cả local + remote branch.
- Sidecar method mới `git.prUrl` (hoặc resolve client-side từ `store.remotes`): parse push URL của remote `origin` → `{ host, owner, repo }`. Hỗ trợ 2 dạng:
  - SSH: `git@github.com:owner/repo.git`
  - HTTPS: `https://github.com/owner/repo(.git)`
- Dựng URL theo host:
  - **GitHub:** `https://github.com/<owner>/<repo>/compare/<head>?expand=1` (base = default branch do GitHub tự chọn).
  - **GitLab:** `https://gitlab.com/<owner>/<repo>/-/merge_requests/new?merge_request%5Bsource_branch%5D=<head>`.
  - **Bitbucket:** `https://bitbucket.org/<owner>/<repo>/pull-requests/new?source=<head>`.
  - Host khác → fallback: chỉ mở URL repo gốc + toast "Push branch & tạo PR thủ công".
- `head` = tên branch (URL-encode). Gọi `sidecar.openExternal(url)` (đã có).
- **Tiền điều kiện:** branch phải đã push (có remote tracking). Nếu `ahead > 0` hoặc chưa có upstream → toast nhắc "Push branch trước khi tạo PR", vẫn cho mở (GitHub báo lỗi nhẹ) hoặc disable — chốt ở Open questions.

## Sidecar IPC contract

Hai method mới, theo khuôn `git.cherry-pick.ts` (mutex + `suppressEchoFor` + envelope conflict + emit `git:status:changed`):

```ts
// git.merge
Params  = { workspaceRoot: string, branch: string }   // branch = ref nguồn để merge vào HEAD
Result  = { ok: true, fastForward: boolean, sha: string, sha7: string }
// Conflict → RpcError(GIT_RPC_CODE, gitCode: MERGE_CONFLICT, { files, stderrSanitized })

// git.rebase
Params  = { workspaceRoot: string, onto: string }      // onto = ref đích để rebase HEAD lên
Result  = { ok: true, sha: string, sha7: string }
// Conflict → RpcError(... MERGE_CONFLICT, { files, rebase: true, stderrSanitized })
```

- **Ref validation:** `branch`/`onto` phải khớp regex an toàn (chữ/số/`/._-`, từ chối ký tự shell, `..`, dấu cách, bắt đầu bằng `-` để chống option-injection). Dùng arg array (không shell string) như mọi method git hiện có.
- `git.prUrl` (optional — có thể làm client-side từ `store.remotes`): `Params = { workspaceRoot }` → `Result = { host, owner, repo } | null`. Không spawn git nếu dùng `remote -v` đã cache trong store.

## UI changes

- **`GitBranchContextMenu.vue`** — thêm emit + item: `merge`, `rebase`, `create-tag`, `create-pr`, `pull`, `push`. Phân nhánh theo `isRemote`/`isCurrent` như [Scope](#scope). Dùng icon lucide: `GitMerge`, `GitPullRequestArrow` / `Replace` (rebase), `Tag`, `GitPullRequest`, `ArrowDownToLine`/`ArrowUpFromLine`.
- **`GitManager.vue`** — thêm handler `onMenuMerge` / `onMenuRebase` / `onMenuCreateTag` / `onMenuCreatePr` nối vào store; mở `GitTagCreateModal` với `targetSha` của branch; confirm modal cho merge/rebase khi dirty.
- **`stores/git/branches.ts`** — action `merge(branch)`, `rebase(onto)` (gọi `useGitApi`, bắt `MERGE_CONFLICT` → set conflict state + toast "mở Conflict Resolver", giống `cherryPick`). `openPrForBranch(branchName)` dựng URL + `openExternal`.
- **`stores/git/conflicts.ts`** — tổng quát hoá `operation` để `completeMerge`/abort gọi đúng lệnh (`rebase --continue|--abort`).
- **`composables/useGitApi.ts`** — thêm `merge`, `rebase`, (optional `prUrl`).
- **`GitBranchTree.vue`** — badge ahead/behind sang 12px font-mono + tooltip.

## Conflict handling

Tái dùng pipeline conflict đã có: method ném `MERGE_CONFLICT` → store set `hasConflict` → `GitConflictResolver` mở. Khác biệt: rebase finalize bằng `git rebase --continue`, abort bằng `git rebase --abort` (không phải `merge --abort`). Vì vậy `conflicts.ts` phải biết operation đang dở.

## Security

- **Invariant #3 (git scope):** mọi method mới spawn `cwd = workspaceRoot`, không nhận path từ payload. ✓
- **Command injection:** `branch`/`onto` validate regex + arg array + chặn leading `-`. ✓
- **Create PR / SSRF:** không `fetch` — chỉ `openExternal` URL đã dựng từ remote đã cấu hình. Validate host nằm trong allowlist dạng provider (github.com/gitlab.com/bitbucket.org) hoặc self-host hợp lệ trước khi mở; URL-encode branch để tránh query injection. Không có token, không gọi API → SSRF n/a.
- **Infosec:** đụng sidecar git surface (2 method mới) + spawn → cần review infosec trước merge (theo [security.md](../../.claude/rules/security.md)).

## i18n

Thêm key `en.json` + `vi.json` (flat dotted), ví dụ:

```
git.branches.menu.merge_into        "Merge into {branch}" / "Merge vào {branch}"
git.branches.menu.rebase_onto       "Rebase onto {branch}" / "Rebase lên {branch}"
git.branches.menu.create_tag        "Create tag…" / "Tạo tag…"
git.branches.menu.create_pr         "Create pull request" / "Tạo pull request"
git.branches.menu.pull              "Pull ({count})" / "Pull ({count})"
git.branches.menu.push              "Push ({count})" / "Push ({count})"
git.branches.ahead_behind_hint      "{ahead} to push · {behind} to pull" / "{ahead} chờ push · {behind} chờ pull"
git.merge.conflict / git.rebase.conflict / git.pr.push_first …
```

## Acceptance Criteria

1. **Given** đang ở branch `main`, **when** right-click branch `feature/x` → "Merge into main" và không conflict, **then** `feature/x` được merge vào `main`, status/branches refresh, toast thành công.
2. **Given** merge gây conflict, **then** Conflict Resolver mở với danh sách file conflict; resolve xong → commit hoàn tất merge; Abort khôi phục HEAD.
3. **Given** đang ở `feature/x`, **when** "Rebase feature/x onto main", **then** chạy `git rebase main`; conflict → resolver dùng `rebase --continue`/`--abort`.
4. **Given** right-click bất kỳ branch → "Create tag…", **then** modal mở, tag tạo tại tip branch đó.
5. **Given** remote `origin` là GitHub, **when** "Create pull request" cho branch đã push, **then** browser mở `.../compare/<branch>?expand=1`.
6. **Given** local branch ahead 2 / behind 3, **then** tree hiển thị `↑2 ↓3` (12px) + tooltip; menu current branch có Pull (3) / Push (2).
7. Menu ẩn/hiện đúng item theo local/remote/current như [Scope](#scope).

## Edge cases

- Repo không có remote → "Create pull request" disabled + tooltip; Pull/Push disabled.
- Branch chưa push (no upstream) → Create PR nhắc push trước.
- Workspace dirty khi merge/rebase → chặn + yêu cầu commit/stash.
- Fast-forward merge → `fastForward: true`, không tạo merge commit.
- Detached HEAD → ẩn Merge/Rebase/Create PR (không có current branch).
- Rebase/merge đang dở (resolver đang mở) → chặn thao tác mới.
- Remote URL lạ (self-hosted) → fallback mở repo URL + toast hướng dẫn.

## Quyết định đã chốt (2026-06-16)

Ghi nhận trong [ADR 0040](../decisions/0040-git-branch-ops-merge-rebase-pr.md):

1. **Conflict lifecycle:** tổng quát hoá — UI suy ra thao tác đang dở từ `git.status` (`isMerging` / `isRebasing`) và dispatch complete/abort tới đúng lệnh (rebase → `rebase --continue|--abort`; còn lại → `completeMerge`/`mergeAbort`). `isRebasing` map vào store (trước đây bị bỏ).
2. **Create PR khi chưa push:** **disable** entry (branch không có upstream) + tooltip nhắc push.
3. **PR base branch:** `GitCreatePrModal` **có UI chọn base** (head = branch nguồn), dựng URL theo base đã chọn.
4. **ADR:** có — [ADR 0040](../decisions/0040-git-branch-ops-merge-rebase-pr.md).
