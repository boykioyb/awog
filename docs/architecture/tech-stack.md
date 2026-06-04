# Tech Stack

## Desktop Shell

| Layer | Lựa chọn | Mục đích |
|---|---|---|
| Shell | **Electron** (main process = Node) | Đóng gói desktop, system tray, native notification, single-instance, vòng đời process |
| Renderer | Chromium (đồng nhất mọi OS) | Render UI Nuxt — bỏ webview đa-engine của Tauri (WKWebView/WebView2/WebKitGTK) |
| IPC renderer↔main | `contextBridge` → `window.awog` | `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false`; UI không `import fs`/`child_process`/SDK |

→ Đã migrate từ Tauri 2 (Rust) sang Electron — xem [ADR 0027](../decisions/0027-tauri-vs-electron-revisit.md) và [electron-migration.md](../features/electron-migration.md). [ADR 0006](../decisions/0006-tauri-shell-for-nuxt.md) (chọn Tauri) bị superseded một phần.

## Frontend

| Layer | Lựa chọn | Mục đích |
|---|---|---|
| Framework | **Nuxt 4** | Framework full-stack Vue (UI + server) |
| UI | **Vue 3 + TypeScript** | Component model với type safety |
| State | **Pinia** | Reactive state store |
| Canvas | **VueFlow** | DAG editor cho workflow |
| Styling | **TailwindCSS** | CSS utility-first |
| Code editing | **Monaco Editor** | Editor nhúng cho prompt và artifact |

## Backend / Engine (Node.js)

| Layer | Lựa chọn | Mục đích |
|---|---|---|
| Runtime | **Node.js** (engine do Electron main spawn) | Host execution engine. Spawn qua `child_process.spawn(process.execPath, { env: { ELECTRON_RUN_AS_NODE: '1' } })` — giữ OAuth token trong engine process, dùng Node ESM loader chuẩn |
| Transport | **NDJSON JSON-RPC 2.0 trên stdin/stdout** | Engine giữ nguyên (không đổi một dòng); main reframe NDJSON + relay envelope giữa renderer ↔ engine |
| LLM client | **Anthropic SDK**, **OpenAI SDK**, adapter cho Gemini và local model | Trung gian gọi model |

## Storage

| Quan tâm | Lựa chọn |
|---|---|
| Persistence | **Local filesystem** |
| Định dạng | **JSON, YAML, Markdown** |
| Versioning | **Git** (cài sẵn trên hệ thống) |

Không có database trong MVP.

## Process Model

- **Electron main process (Node)** là entry point: tạo `BrowserWindow` load Nuxt SPA (dev `http://localhost:3030`; prod custom protocol `app://` phục vụ `apps/desktop/ui/.output/public`), quản lý tray, notification, single-instance, lifecycle.
- **Node.js engine** chạy process riêng do main spawn (`ELECTRON_RUN_AS_NODE`): host execution engine, giữ API key/OAuth token bên trong.
- **Renderer (Chromium)** load Nuxt UI; gọi engine qua `window.awog.request(...)` → main relay vào engine theo NDJSON JSON-RPC.
- Đóng cửa sổ ≠ thoát ứng dụng. Tray icon giữ engine sống để task dài tiếp tục chạy.

## Deployment

- **Desktop app đóng gói qua `electron-builder`** cho macOS (.dmg/.zip), Windows (.exe — nsis), Linux (.AppImage/.deb).
- **Không cloud sync** trong MVP.
- **Không bundle Node runtime riêng** — Electron đã mang sẵn Node. UI build + engine bundle ship như `extraResources` NGOÀI asar. Claude CLI native binary (`@anthropic-ai/claude-agent-sdk-<os>-<arch>/claude`) đi kèm qua `pnpm deploy --config.node-linker=hoisted` (node_modules phẳng, self-contained). [ADR 0007](../decisions/0007-bundle-nodejs-runtime.md) (download Node self-contained) bị superseded — xem [electron-migration.md](../features/electron-migration.md).

## Tóm tắt lý do

- Nuxt hợp nhất UI và server-side engine, không cần backend riêng.
- Electron cho cảm giác desktop app thực thụ với tray, notification, background process — cần thiết cho task chạy dài; main process là Node nên khớp tự nhiên với engine Node (không cần bundle Node riêng, render UI nhất quán trên một Chromium).
- Filesystem + Git cung cấp versioning, diff và portability miễn phí, không cần database.
- SDK của từng model provider được tách rời sau Model Adapter interface.

Lý do chi tiết tại [../decisions/](../decisions/).
