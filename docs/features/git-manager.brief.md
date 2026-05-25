# Feature Brief: Git Manager

> **Status:** Draft
> **Owner:** Product Owner (AWOG)
> **Created:** 2026-05-25

## Problem

Trong AWOG, mọi artifact (requirement, architecture, patch, review, test-report) được agent đọc/ghi liên tục và Git là cơ chế versioning duy nhất (no-database). Khi một workflow chạy nhiều phase, agent sẽ commit hàng chục lần vào workspace; user cần xem chính xác agent đã thay đổi gì, phase nào sinh ra change đó, và quay lui khi không hài lòng — nhưng hiện tại user phải nhảy ra terminal hoặc VS Code để làm Git ops. Việc context-switch giữa AWOG (nơi thấy phase/artifact/trace) và một Git client bên ngoài (nơi thấy diff/commit) phá vỡ luồng review artifact-driven và khiến audit trail của agent commit trở nên rời rạc.

Đồng thời, vì AWOG là local-first và restart-safe, state thực sự của workspace nằm trong `.git/` — nếu UI không hiển thị được uncommitted change, stash, branch hiện hành, user không có cách nào biết workspace có "sạch" để chạy task mới hay không.

## Target user

- **Persona:** Solo builder / tech-lead đang chạy AI guild trên codebase local của mình. Đã quen Git CLI nhưng không muốn rời AWOG khi đang review artifact do agent vừa sinh.
- **Tần suất gặp problem:** Hằng ngày, mỗi lần chạy task (mỗi phase sinh ≥ 1 commit).
- **Workaround hiện tại:** Mở terminal song song (`git status`, `git diff`, `git log`) hoặc bật VS Code Source Control bên cạnh AWOG; copy hash commit thủ công để map sang phase trong Agent Trace.

## Why now

- MVP scope đã chốt "Versioning bằng Git" — không có UI Git nghĩa là dòng đó không kiểm chứng được trong tiêu chí thành công.
- Task Execution Engine + Human Approval đang chuẩn bị wire với sidecar; **auto-commit của agent sau mỗi phase** chỉ trust được khi user review được commit đó ngay trong app.
- Artifact System đã có Diff viewer cho `.diff`/`.patch` — tận dụng được cho Git diff mà không cần thêm thư viện.
- Rerun-from-here cần "rollback an toàn" (revert artifact về version trước) — chỉ khả thi khi có Branch/Stash UI.
- Unblock: feature **agent auto-commit per phase**, **review changes do agent tạo**, **resume task sau restart** (kiểm tra workspace dirty trước khi resume).

## Hypothesis

Nếu AWOG cung cấp Git Manager native với 4 nhóm thao tác (Status+Stage+Commit / Diff / Fetch-Pull-Push / Stash+Branch+Conflict resolve), thì user sẽ review và phê duyệt artifact trong cùng một cửa sổ, không cần mở Git client ngoài; đo bằng việc 80% commit do agent sinh được user xem qua Diff viewer trong app trước khi approve phase tiếp theo.

## Success criteria

- User có thể hoàn thành full vòng "agent commit → xem diff → approve / revert" trong AWOG mà **không mở terminal hoặc Git client ngoài** trong ≥ 80% phiên task.
- Mọi commit do agent sinh ra có thể map 1-1 sang một phase trong Agent Trace (clickable cross-link cả hai chiều).
- User detect được workspace dirty/conflict **trước khi** Task Runner cho phép chạy task mới (block hoặc cảnh báo rõ ràng).
- Resolve conflict trong app cho merge-conflict đơn giản (2-way pick) trong < 1 phút mà không phải edit file qua editor ngoài.
- Push/Pull/Fetch hoạt động với remote đã cấu hình; lỗi auth (SSH key, token) được surface rõ trong UI thay vì im lặng.

## Fit with vision

| Tiêu chí | Đánh giá |
|---|---|
| Artifact-driven | Yes — Git Manager hiển thị artifact change ở cấp version; commit = snapshot artifact tại một phase. |
| Workflow-based | Yes — mỗi commit gắn 1 phase trong workflow; auto-commit là cơ chế chuyển công việc giữa agent. |
| Human-in-the-loop | Yes — user review diff trước khi approve; revert / stash là approval checkpoint mạnh nhất. |
| Local-first | Yes — toàn bộ thao tác trên `.git/` local; push/pull chỉ khi user chủ động và remote do user cấu hình. |

## Scope hint

- **In MVP** — củng cố dòng "Versioning bằng Git" trong [mvp-scope.md](../requirements/mvp-scope.md).
- Layer chạm: UI (Nuxt page + components) / Sidecar Node.js (spawn `git` với `cwd = workspaceRoot`, theo invariant #3 security) / Storage (chỉ đọc/ghi qua sidecar).
- Ước lượng độ lớn (PM sẽ refine): **L** — 4 nhóm thao tác, conflict resolver là phần khó nhất.

## Scope MVP (4 nhóm đã chốt với user)

1. **Status + Stage + Commit** — danh sách working tree change, stage / unstage từng file hoặc hunk, commit kèm message (auto-fill template cho agent commit).
2. **Diff viewer** — tái dùng diff component sẵn có cho `.diff`/`.patch`; xem cả uncommitted diff lẫn diff của một commit cụ thể.
3. **Fetch / Pull / Push** — với remote đã cấu hình; surface lỗi auth/network rõ ràng.
4. **Stash + Branch + Resolve conflict** — list/create/checkout branch, stash save/pop, basic 2-way conflict picker cho merge xung đột.

## Out of scope (cho v1)

- Rebase interactive, cherry-pick, reset --hard / --mixed bằng UI (user vẫn dùng CLI cho ops nâng cao).
- Submodule, Git LFS, sparse checkout, worktree multi-folder.
- GitHub / GitLab PR review trong app (sẽ là connector v-next, đã loại khỏi MVP).
- Blame view, file history graph kiểu gitk.
- Hooks UI (đã thuộc feature `hooks` — không trộn).
- Quản lý nhiều remote đồng thời (MVP: 1 origin).
- Sign commit (GPG/SSH signing) — config qua workspace, không có UI.
- Credential manager — dựa vào git credential helper sẵn có của OS.

## Risks / open questions cho BA

- **Auto-commit per phase**: ai trigger (sidecar engine hay agent), message format chuẩn nào, scope file (chỉ artifact phase đó hay toàn workspace)? → cần spec rõ trong BA pass.
- **Conflict resolver UI**: 2-way pick có đủ cho merge của agent commit (thường linear) không, hay cần 3-way?
- **Cross-link Agent Trace ↔ commit**: lưu commit hash trong trace event, hay tag/note Git? Ảnh hưởng đến data-model.
- **Workspace dirty policy** trước khi chạy task mới: block hard, warn soft, hay auto-stash? Quyết định UX quan trọng.
- **Remote auth**: SSH key reuse từ OS keychain hay AWOG quản lý token? Cần phối hợp infosec (invariant #1: secret không lộ lên UI).
- **Sidecar API surface**: granularity (1 RPC per git command vs grouped)? Tech-lead cần ADR cho boundary IPC.
- **Performance** với repo lớn (status > 10k file)? — cần budget và async streaming.
- **Git binary dependency**: yêu cầu user cài Git, hay bundle? (ảnh hưởng install size Tauri).

## Liên kết

- [VISION](../../artifacts/VISION.md)
- [MVP scope](../requirements/mvp-scope.md) — dòng "Versioning bằng Git"
- [Product overview](../requirements/product-overview.md)
- [Artifact System](./artifact-system.md) — diff viewer tái dùng
- [Task Execution Engine](./task-execution-engine.md) — auto-commit per phase
- [Agent Trace](./agent-trace.md) — cross-link commit ↔ phase
- [Human Approval](./human-approval.md) — revert là một dạng approval action
- Security: [.claude/rules/security.md](../../.claude/rules/security.md) invariant #3 (Git scope = workspace)
