# Architecture Decision Records (ADR)

Thư mục này lưu các quyết định kiến trúc quan trọng của AWOG. Mỗi ADR ghi lại **đã quyết định gì**, **tại sao**, và **các phương án thay thế** đã cân nhắc, để người đóng góp sau này hiểu lý do đằng sau codebase.

## Danh mục

| # | Tiêu đề | Trạng thái |
|---|---|---|
| [0001](./0001-local-first-storage.md) | Lưu trữ filesystem local-first (không database trong MVP) | Accepted |
| [0002](./0002-git-as-version-control.md) | Dùng Git cho artifact versioning | Accepted |
| [0003](./0003-nuxt-fullstack.md) | Nuxt 4 làm frontend + server hợp nhất | Superseded by 0006 |
| [0004](./0004-artifacts-as-source-of-truth.md) | Artifact là cơ chế chính để các agent cộng tác | Accepted |
| [0005](./0005-isolated-agent-sessions.md) | Mỗi agent có session độc lập | Accepted |
| [0006](./0006-tauri-shell-for-nuxt.md) | Tauri làm shell đóng gói cho Nuxt | Accepted |
| [0007](./0007-bundle-nodejs-runtime.md) | Bundle Node.js runtime cùng binary | Accepted |
| [0008](./0008-stdio-ipc-for-sidecar.md) | Stdio IPC giữa Tauri shell và Node.js sidecar | Accepted |
| [0009](./0009-dev-mode-http-fallback.md) | Dev-mode HTTP fallback cho sidecar | Accepted |
| [0010](./0010-pause-on-quota-for-connection-switch.md) | Pause-on-quota để cho phép switch connection thủ công | Accepted |

## Template

Dùng [`template.md`](./template.md) làm điểm bắt đầu cho ADR mới.

## Quy ước

- Tên file: `NNNN-kebab-case-title.md`, đánh số tuần tự với padding 0.
- Giá trị trạng thái: **Proposed**, **Accepted**, **Deprecated**, **Superseded by NNNN**.
- Sau khi Accepted, nội dung ADR là **bất biến** — thay bằng ADR mới chứ không sửa lại.
- Mỗi ADR tập trung vào một quyết định duy nhất.
