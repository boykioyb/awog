# System Overview

## Kiến trúc tổng quan

AWOG là một **desktop application** đóng gói bằng Electron, với Nuxt 4 làm UI (render trong Chromium) + execution engine chạy như Node.js process riêng. Toàn bộ hệ thống chạy local trên máy người dùng. Không có backend service tách rời, không có database, không có thành phần cloud (trong MVP). Đã migrate từ Tauri (Rust) — xem [ADR 0027](../decisions/0027-tauri-vs-electron-revisit.md) và [electron-migration.md](../features/electron-migration.md).

```
┌──────────────────────────────────────────────────────────┐
│              Electron Main process (Node)                │
│  ┌────────────────────────────────────────────────────┐  │
│  │  System Tray  │  Notification  │  Window Lifecycle │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Renderer (Chromium)   ◄─ contextBridge window.awog│  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  Nuxt 4 UI + Vue 3 + Pinia + VueFlow + Monaco│  │  │
│  │  │  Agents | Skills | Workflows | Tasks | Artif.│  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────┘
                           │ stdio JSON-RPC (NDJSON, ELECTRON_RUN_AS_NODE spawn)
┌──────────────────────────┴───────────────────────────────┐
│          Node.js Engine (do Electron main spawn)         │
│  ┌──────────────┐  ┌────────────┐  ┌────────────────┐    │
│  │ Execution    │  │ Workspace  │  │ Model Adapters │    │
│  │ Engine       │  │ Repo       │  │ (Anthropic,    │    │
│  │              │  │ (FS + Git) │  │  OpenAI, ...)  │    │
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

### Electron Main process (Node)

- Entry point của ứng dụng (`apps/desktop/electron/`).
- Tạo `BrowserWindow` load Nuxt SPA: dev `http://localhost:3031`; prod custom protocol `app://` phục vụ `apps/desktop/ui-next/.output/public`.
- Quản lý cửa sổ chính (mở, đóng, minimize), single-instance.
- System tray với menu: mở app, xem task đang chạy, quit.
- Native notification khi task hoàn tất hoặc cần approval.
- Spawn và giám sát Node.js engine; relay JSON-RPC envelope renderer ⇄ engine.
- Đóng cửa sổ **không** thoát ứng dụng — engine tiếp tục chạy ở tray.

### Renderer (Chromium) + Nuxt UI

- Render trong Chromium do Electron mang theo (đồng nhất mọi OS — thay webview đa-engine của Tauri).
- Render mọi editor (agent, skill, workflow, artifact).
- Quản lý UI state cục bộ bằng Pinia.
- `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false`; **không** `import fs`/`child_process`/SDK.
- Giao tiếp với engine qua `contextBridge` (`window.awog.request/onEvent/openExternal/revealPath/openPath/pickFolder/savePath`); main forward sang engine qua stdio JSON-RPC ([ADR 0008](../decisions/0008-stdio-ipc-for-sidecar.md)).

### Node.js Engine

- Sở hữu execution engine.
- Spawn bởi main qua `child_process.spawn(process.execPath, { env: { ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe','pipe','pipe'] })` — chạy binary Electron như Node thuần (ESM loader chuẩn). Engine giữ nguyên, không đổi.
- Trung gian gọi API của model — API key/OAuth token **chỉ** ở engine process, không vào renderer.
- Đọc/ghi thư mục workspace, thao tác Git.
- **Production:** không mở port mạng — nhận lệnh qua stdin (NDJSON JSON-RPC 2.0), trả response/event qua stdout, log qua stderr ([ADR 0008](../decisions/0008-stdio-ipc-for-sidecar.md)).
- **Dev mode:** khi chạy với `AWOG_DEV_HTTP=1`, bind thêm HTTP loopback có dev token để Nuxt HMR gọi được engine khi `nuxt dev` chạy ngoài Electron ([ADR 0009](../decisions/0009-dev-mode-http-fallback.md)).

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

- **Hai process.** Electron main (Node) là parent, Node.js engine là child (spawn qua `ELECTRON_RUN_AS_NODE`).
- **Thực thi async.** Task chạy trên worker loop trong engine; gọi model dài không block IPC.
- **Event sourcing cho trace.** Mỗi bước append một event JSON Lines vào `events.log` của task.
- **State trên đĩa.** Không có authoritative state trong RAM — restart-safe.
- **Sống ở tray.** Engine tiếp tục chạy khi đóng cửa sổ; notification kéo người dùng quay lại khi cần.

## Non-Goals (MVP)

- Không có worker pool đa process bên trong engine.
- Không có distributed execution.
- Không có message queue bên ngoài.
- Không có database (filesystem là data layer).
