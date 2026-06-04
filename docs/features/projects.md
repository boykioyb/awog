# Feature: Projects

**Trạng thái:** Approved
**Ngày approve:** 2026-05-27

## Overview

Project là một codebase local đã đăng ký trong AWOG. Mọi Task đều bắt buộc gắn với một Project — điều này cho phép agent biết context code đang làm việc và cho người dùng nhóm task theo codebase.

## User Stories

- Là người dùng, tôi muốn đăng ký các repo local trên máy để task chạy có context đúng codebase.
- Là người dùng, tôi muốn clone repo từ Git remote trực tiếp trong AWOG để không phải bật terminal.
- Là người dùng, tôi muốn xem nhanh các task đã/đang chạy trên một project.

## Functional Behavior

### CRUD đầy đủ

- **Tạo**: hai mode
  - **Link existing folder** — chọn path local có sẵn.
  - **Clone từ Git** — nhập `gitRemote`, AWOG clone về thư mục được chỉ định.
- **Xem**: project detail hiển thị metadata + danh sách task liên quan.
- **Sửa**: cập nhật description, branch, language.
- **Xóa**: với confirmation modal. Xóa project không xóa codebase trên đĩa (chỉ unlink khỏi AWOG).

### Project metadata

| Field | Kiểu | Mô tả |
|---|---|---|
| `id` | string | Slug duy nhất |
| `name` | string | Tên hiển thị, ví dụ `loyalty-service` |
| `path` | string | Path local, ví dụ `~/code/acme/loyalty-service` |
| `description` | string | Mô tả ngắn |
| `gitRemote` | string | URL remote, ví dụ `git@github.com:acme/loyalty-service.git` |
| `gitBranch` | string | Branch mặc định |
| `language` | string | Python, Go, TypeScript, … |
| `createdAt` | timestamp | Thời điểm đăng ký |

### Project detail view

- **3 meta box**: Branch / Language / Created.
- **Git Remote section** với link mở external.
- **Session list của project**: các session có `projectId` khớp, hiển thị title + thời điểm cập nhật + số message (+ số agent nếu có), sort mới nhất trước. Click jump sang Sessions view và select session đó.
  - Nút **New session** trong header section: tạo session mới gắn sẵn `projectId` này rồi điều hướng sang Sessions view với session vừa tạo đang được chọn.
- **Task list của project** với status icon, click jump sang Tasks view và select task đó.

## UI/UX

- Top bar hiện breadcrumb project: `<name> · <branch> · <path>` khi đang ở task của project đó.
- Item project trong list: tên + path tóm tắt (không có count badge — bỏ để list gọn).

## Lưu trữ dữ liệu

`~/.awog/projects/<project-id>.json` — plain JSON 1 file per project. Atomic write (`.tmp` + rename). Xem [ADR 0012](../decisions/0012-projects-storage.md).

ID format: `prj-<base36-timestamp>-<base36-counter>`.

## Phụ thuộc

- [task-execution-engine](./task-execution-engine.md) — task tham chiếu projectId.

## Out of Scope

- Auto-discover repo từ thư mục home.
- Pull / push Git từ trong AWOG (sau MVP).
- Branch switching từ UI.

## Câu hỏi mở

- Khi project bị move/rename ngoài AWOG → **deferred sau MVP**. Trước mắt: nếu task chạm path không tồn tại, sidecar trả error rõ ràng, UI hiển thị "Path missing" trên project detail.
- Project setting riêng override workspace setting → **deferred sau MVP**. Hiện tại không có per-project setting.

## Acceptance Criteria

- **AC1 — Link existing folder:** Chọn mode "Existing folder", nhập tên + path tồn tại trên đĩa → project xuất hiện trong list. Restart UI → vẫn còn.
- **AC2 — Clone từ Git:** Chọn mode "Clone", nhập gitRemote + destination → AWOG clone về folder đó, project xuất hiện với gitBranch = branch mặc định của remote. Folder đã tồn tại tại destination → reject với error rõ ràng.
- **AC3 — Edit:** Sửa description / branch / language → save → reload UI → giá trị mới persist.
- **AC4 — Delete:** Click delete + confirm → project biến mất khỏi UI, **folder trên đĩa vẫn còn**. Task tham chiếu projectId này hiển thị orphan (giữ projectId, không crash).
- **AC5 — Path validate:** Link path không tồn tại → reject với message "Path does not exist". Path chứa `..` literal → reject.
- **AC6 — gitRemote validate:** Khi clone, chỉ chấp nhận scheme `https://`, `http://`, `git@`, `ssh://`. URL khác → reject.
- **AC7 — Task list:** Project detail hiển thị danh sách task có `projectId` khớp, click jump sang Tasks và select task đó.
- **AC8 — Session list:** Project detail hiển thị danh sách session có `projectId` khớp (mới nhất trước), click jump sang Sessions và select session đó. Click **New session** → tạo session mới với `projectId` này, điều hướng sang Sessions với session đó đang được chọn. Không có session → empty state "No sessions yet for this project".
