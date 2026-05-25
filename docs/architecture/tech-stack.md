# Tech Stack

## Desktop Shell

| Layer | Lựa chọn | Mục đích |
|---|---|---|
| Shell | **Tauri** | Đóng gói desktop, system tray, native notification, vòng đời process |
| Webview | WKWebView / WebView2 / WebKitGTK | Render UI Nuxt theo từng OS |

→ Xem [ADR 0006](../decisions/0006-tauri-shell-for-nuxt.md)

## Frontend

| Layer | Lựa chọn | Mục đích |
|---|---|---|
| Framework | **Nuxt 4** | Framework full-stack Vue (UI + server) |
| UI | **Vue 3 + TypeScript** | Component model với type safety |
| State | **Pinia** | Reactive state store |
| Canvas | **VueFlow** | DAG editor cho workflow |
| Styling | **TailwindCSS** | CSS utility-first |
| Code editing | **Monaco Editor** | Editor nhúng cho prompt và artifact |

## Backend / Engine (Node.js sidecar)

| Layer | Lựa chọn | Mục đích |
|---|---|---|
| Runtime | **Node.js** (sidecar do Tauri spawn) | Host execution engine và Nuxt server |
| Server | **Nuxt server API route** | API gọi từ webview |
| LLM client | **Anthropic SDK**, **OpenAI SDK**, adapter cho Gemini và local model | Trung gian gọi model |

## Storage

| Quan tâm | Lựa chọn |
|---|---|
| Persistence | **Local filesystem** |
| Định dạng | **JSON, YAML, Markdown** |
| Versioning | **Git** (cài sẵn trên hệ thống) |

Không có database trong MVP.

## Process Model

- **Tauri (Rust)** là entry point: quản lý cửa sổ, tray, notification, lifecycle.
- **Node.js sidecar** chạy ngầm: host Nuxt server + execution engine.
- **Webview** load Nuxt UI từ sidecar qua localhost (hoặc IPC).
- Đóng cửa sổ ≠ thoát ứng dụng. Tray icon giữ engine sống để task dài tiếp tục chạy.

## Deployment

- **Desktop app đóng gói qua Tauri** cho macOS (.dmg/.app), Windows (.msi/.exe), Linux (.AppImage/.deb).
- **Không cloud sync** trong MVP.
- **Bundle Node.js runtime kèm binary** ([ADR 0007](../decisions/0007-bundle-nodejs-runtime.md)) — người dùng không cần cài Node trước. Tổng binary khoảng 60–80MB (10–20MB Tauri shell + 40–60MB Node runtime).

## Tóm tắt lý do

- Nuxt hợp nhất UI và server-side engine, không cần backend riêng.
- Tauri cho cảm giác desktop app thực thụ với tray, notification, background process — cần thiết cho task chạy dài.
- Filesystem + Git cung cấp versioning, diff và portability miễn phí, không cần database.
- SDK của từng model provider được tách rời sau Model Adapter interface.

Lý do chi tiết tại [../decisions/](../decisions/).
