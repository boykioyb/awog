# Feature: Projects

**Trạng thái:** Draft

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
- **Task list của project** với status icon, click jump sang Tasks view và select task đó.

## UI/UX

- Top bar hiện breadcrumb project: `<name> · <branch> · <path>` khi đang ở task của project đó.
- Item project trong list: tên + path tóm tắt + count task active.

## Lưu trữ dữ liệu

`workspace/projects/<project-id>.json`.

## Phụ thuộc

- [task-execution-engine](./task-execution-engine.md) — task tham chiếu projectId.

## Out of Scope

- Auto-discover repo từ thư mục home.
- Pull / push Git từ trong AWOG (sau MVP).
- Branch switching từ UI.

## Câu hỏi mở

- Khi project bị move/rename ngoài AWOG, phát hiện và xử lý thế nào?
- Project có nên chứa setting riêng (ví dụ context provider whitelist) override workspace setting?
