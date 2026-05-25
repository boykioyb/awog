# System Overview

## Kiến trúc tổng quan

AWOG là một **desktop application** đóng gói bằng Tauri, với Nuxt 4 làm UI + server-side engine chạy như Node.js sidecar. Toàn bộ hệ thống chạy local trên máy người dùng. Không có backend service tách rời, không có database, không có thành phần cloud (trong MVP).

```
┌──────────────────────────────────────────────────────────┐
│                  Tauri Shell (Rust)                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │  System Tray  │  Notification  │  Window Lifecycle │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Webview (WKWebView / WebView2 / WebKitGTK)        │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  Nuxt 4 UI + Vue 3 + Pinia + VueFlow + Monaco│  │  │
│  │  │  Agents | Skills | Workflows | Tasks | Artif.│  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────┘
                           │ stdio IPC (JSON-RPC trên stdin/stdout)
┌──────────────────────────┴───────────────────────────────┐
│             Node.js Sidecar (do Tauri spawn)             │
│  ┌──────────────┐  ┌────────────┐  ┌────────────────┐    │
│  │ Nuxt Server  │  │ Workspace  │  │ Model Adapters │    │
│  │ + Execution  │  │ Repo       │  │ (Anthropic,    │    │
│  │ Engine       │  │ (FS + Git) │  │  OpenAI, ...)  │    │
│  └──────────────┘  └────────────┘  └────────────────┘    │
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────┐
│             Local Filesystem (workspace/)                │
│   agents/  skills/  workflows/  tasks/  artifacts/       │
│                sessions/   .git/                         │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
                    Model API bên ngoài
        (Anthropic, OpenAI, Google, llama.cpp local)
```

## Component

### Tauri Shell (Rust)

- Entry point của ứng dụng.
- Quản lý cửa sổ chính (mở, đóng, minimize).
- System tray với menu: mở app, xem task đang chạy, quit.
- Native notification khi task hoàn tất hoặc cần approval.
- Spawn và giám sát Node.js sidecar.
- Đóng cửa sổ **không** thoát ứng dụng — engine tiếp tục chạy ở tray.

### Webview + Nuxt UI

- Render trong webview do hệ điều hành cung cấp (WKWebView / WebView2 / WebKitGTK).
- Render mọi editor (agent, skill, workflow, artifact).
- Quản lý UI state cục bộ bằng Pinia.
- Giao tiếp với Node.js sidecar qua Tauri command (`invoke` / `listen`), Tauri forward sang sidecar qua stdio IPC ([ADR 0008](../decisions/0008-stdio-ipc-for-sidecar.md)).

### Node.js Sidecar

- Sở hữu execution engine.
- Trung gian gọi API của model (API key không rời máy local).
- Đọc/ghi thư mục workspace, thao tác Git.
- **Production:** không mở port mạng — nhận lệnh qua stdin (JSON-RPC), trả response/event qua stdout, log qua stderr ([ADR 0008](../decisions/0008-stdio-ipc-for-sidecar.md)).
- **Dev mode:** khi chạy với `AWOG_DEV_HTTP=1`, bind thêm HTTP loopback có dev token để Nuxt HMR gọi được engine khi `nuxt dev` chạy ngoài Tauri ([ADR 0009](../decisions/0009-dev-mode-http-fallback.md)).

### Execution Engine

- Lập lịch các workflow node.
- Quản lý vòng đời task và trạng thái.
- Persist trace event.
- Tạm dừng tại approval gate; resume khi người dùng tác động (có thể từ notification).

### Workspace Repository

- Bọc các thao tác đọc/ghi filesystem.
- Thực hiện các thao tác Git (auto-commit, history, diff).
- Validate format file.

### Model Adapter

- Pluggable theo từng provider (Anthropic SDK, OpenAI SDK, Gemini, local).
- Chuẩn hóa giao diện tool call và streaming.

## Runtime Model

- **Hai process.** Tauri (Rust) là parent, Node.js là sidecar child.
- **Thực thi async.** Task chạy trên worker loop trong sidecar; gọi model dài không block API route.
- **Event sourcing cho trace.** Mỗi bước append một event JSON Lines vào `events.log` của task.
- **State trên đĩa.** Không có authoritative state trong RAM — restart-safe.
- **Sống ở tray.** Engine tiếp tục chạy khi đóng cửa sổ; notification kéo người dùng quay lại khi cần.

## Non-Goals (MVP)

- Không có worker pool đa process bên trong sidecar.
- Không có distributed execution.
- Không có message queue bên ngoài.
- Không có database (filesystem là data layer).
