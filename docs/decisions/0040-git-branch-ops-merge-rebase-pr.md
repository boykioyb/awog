# 0040 — Git branch ops: merge/rebase trong sidecar, Create PR qua browser

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-16
- **Người quyết định:** Tech Lead (chốt với user)

## Bối cảnh

Context menu branch của Git Manager ([git-manager.md](../features/git-manager.md)) mới có Checkout / New branch / Rename / Copy / Delete. Người dùng cần thêm **Merge, Rebase, Create tag, Create PR** và hiển thị **ahead/behind** rõ ràng ([spec](../features/git-context-menu-enhancements.md)). Ba điểm cần quyết định kiến trúc:

1. **Merge/Rebase** chưa có method sidecar (chỉ có `merge-abort`/`complete-merge` phục vụ Conflict Resolver). Cần thêm spawn `git`.
2. **Create PR** — tạo PR đòi hỏi hoặc `gh` CLI, hoặc GitHub API + token, hoặc chỉ mở web. Liên quan trực tiếp tới triết lý local-first + "không thêm dependency/backend" + invariant API-key/SSRF.
3. **Conflict lifecycle** hiện hardcode cho merge (`completeMerge` = `git commit`, `mergeAbort` = `git merge --abort`). Rebase finalize phải dùng `git rebase --continue`/`--abort` → cần tổng quát hoá.

## Quyết định

1. **Merge & Rebase chạy trong sidecar** bằng 4 method `git.*` mới: `git.merge`, `git.rebase`, `git.rebaseContinue`, `git.rebaseAbort` — cùng khuôn `git.cherryPick` (mutex per workspace, `suppressEchoFor`, conflict → envelope `MERGE_CONFLICT`, `cwd = workspaceRoot`). Rebase **non-interactive** (`git rebase <onto>`); không hỗ trợ `rebase -i`.

2. **Create PR = mở browser tới compare/new-MR URL** dựng từ remote `origin`, qua `sidecar.openExternal`. **Không** tạo PR trong app (không `gh`, không GitHub API, không token). Hỗ trợ GitHub / GitLab / Bitbucket; host khác fallback mở URL repo. Entry **disabled khi branch chưa push** (không có upstream).

3. **Conflict lifecycle tổng quát hoá theo git state**: thay vì giả định luôn là merge, UI suy ra thao tác đang dở từ `git.status` (`isMerging` ⇐ `MERGE_HEAD`, `isRebasing` ⇐ `rebase-merge`/`rebase-apply`). Resolver "complete"/"abort" dispatch: rebase → `git.rebaseContinue`/`git.rebaseAbort`; còn lại (merge/cherry-pick/revert) → `git.completeMerge`/`git.mergeAbort` (giữ nguyên hành vi cũ). `isRebasing` được map vào store (trước đây bị bỏ).

## Phương án đã cân nhắc

- **Create PR qua `gh` CLI** — tạo PR thật trong app, nhưng thêm phụ thuộc binary ngoài + trạng thái auth của `gh`, chỉ GitHub, nhiều nhánh lỗi (chưa cài / chưa login). Từ chối: nặng so với giá trị, lệch local-first.
- **Create PR qua GitHub API + token** — mạnh nhất nhưng lock-in GitHub, thêm surface token/keychain + SSRF, cần lưu credential. Từ chối cho MVP: vượt scope, rủi ro bảo mật.
- **Theo dõi `operation` thủ công trong store** (set khi merge/rebase/cherry-pick throw) — đơn giản nhưng mất trạng thái khi reload giữa chừng conflict. Từ chối: suy ra từ git state (`MERGE_HEAD`/`rebase-*`) là nguồn sự thật, restart-safe.
- **Interactive rebase UI** — giá trị cao nhưng phức tạp lớn (reorder/squash/edit, todo editor). Hoãn (out of scope), chỉ làm rebase thẳng.

## Hệ quả

- **Tích cực:**
  - Merge/rebase trong app, tái dùng Conflict Resolver sẵn có; rebase finalize đúng (`--continue`/`--abort`) và restart-safe vì derive từ git state.
  - Create PR zero-dependency, zero-auth, đa provider — giữ invariant #1 (API key) và #7 (SSRF) vì không gọi API, chỉ `openExternal` URL đã dựng từ remote cấu hình.
  - `isRebasing` từ nay phản ánh đúng ở UI (banner/label "rebase" thay vì "merge").
- **Tiêu cực / Trade-off:**
  - Không tạo PR/điền title-body trong app — người dùng hoàn tất trên web.
  - Rebase non-interactive: không reorder/squash từ UI.
  - Thêm 4 method spawn `git` ⇒ tăng surface infosec (command injection): bắt buộc validate ref (allowlist ký tự, chặn leading `-`, arg array).
- **Việc cần làm tiếp:**
  - Implement theo [spec](../features/git-context-menu-enhancements.md); review **infosec** trước merge (đụng git spawn surface).
  - `GitCreatePrModal` có chọn base branch (head = branch nguồn).
  - Label nút Complete/Abort ở `GitPageHeader` theo `isRebasing`.

## Tham chiếu

- [ADR 0017 — Git Manager IPC contract](./0017-git-manager-ipc-contract.md)
- [Feature: Git branch context-menu enhancements](../features/git-context-menu-enhancements.md)
- [Feature: Git Manager](../features/git-manager.md)
- [.claude/rules/security.md](../../.claude/rules/security.md) — invariant #1, #3, #7
