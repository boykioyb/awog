# 0006 — Tauri làm shell đóng gói cho Nuxt

- **Trạng thái:** Accepted — **Superseded by [ADR 0027](./0027-tauri-vs-electron-revisit.md)** (2026-06-05) — shell chuyển từ Tauri sang Electron.
- **Ngày:** 2026-05-24
- **Supersedes:** [0003](./0003-nuxt-fullstack.md)

> **Cập nhật 2026-06-05:** Lớp shell Tauri/Rust đã được thay bằng Electron main process (`apps/desktop/electron/`). Lý do tóm tắt: engine AWOG vĩnh viễn là Node, nên lợi thế size của Tauri bốc hơi một khi phải bundle Node. Xem [ADR 0027](./0027-tauri-vs-electron-revisit.md) + [docs/features/electron-migration.md](../features/electron-migration.md).

## Bối cảnh

[0003](./0003-nuxt-fullstack.md) chọn Nuxt 4 làm framework hợp nhất và bác bỏ Electron/Tauri vì độ phức tạp. Tuy nhiên use case cốt lõi của AWOG là chạy task dài (workflow nhiều bước có thể kéo dài hàng giờ, gọi nhiều model). Trải nghiệm "web thuần" cho task dài có nhiều điểm yếu:

- Người dùng phải giữ terminal mở để Nuxt server sống.
- Phải giữ tab trình duyệt mở để theo dõi tiến độ.
- Không có native notification khi task xong hoặc cần approval.
- Không có system tray / dock indicator.
- Không có cảm giác là một ứng dụng — chỉ là `localhost:3000`.

## Quyết định

Giữ **Nuxt 4** làm core UI + server (như [0003](./0003-nuxt-fullstack.md) đã chọn), nhưng đóng gói qua **Tauri** làm shell desktop. Nuxt build ra static + server bundle; Tauri quản lý cửa sổ, system tray, native notification, và vòng đời process.

```
┌─────────────────────────────────────────┐
│  Tauri Shell (Rust)                     │
│  ├── System tray + notification         │
│  ├── Cửa sổ webview (WKWebView/WebView2)│
│  │   └── Nuxt UI (Vue 3 + Pinia + …)    │
│  └── Sidecar: Node.js                   │
│      └── Nuxt server + execution engine │
└─────────────────────────────────────────┘
```

## Phương án đã cân nhắc

- **Nuxt web thuần (lựa chọn cũ ở 0003)** — UX cho task dài kém: phải giữ terminal + browser, không có notification, không có tray.
- **Electron** — Tính năng tương đương Tauri (tray, notification, background) nhưng binary ~100MB do bundle Chromium; rendering khác nhau giữa OS, dùng cùng engine khắp nơi nhưng tốn RAM.
- **Tauri với backend Rust thuần (không Node.js)** — Loại bỏ runtime Node.js phía người dùng, nhưng phải viết lại execution engine, model adapter, Git integration sang Rust — chi phí lớn, phá vỡ hệ sinh thái SDK Anthropic/OpenAI.
- **Tauri + Node.js sidecar (đã chọn)** — Giữ trọn vẹn execution engine viết bằng TypeScript/Node, đồng thời có shell native nhẹ.

## Hệ quả

- **Tích cực:**
  - Binary ~10–20MB thay vì ~100MB (Electron).
  - System tray cho phép task chạy nền sau khi đóng cửa sổ.
  - Native notification khi task hoàn tất / cần approval.
  - Cảm giác là một desktop app thực thụ, không phải "tab trình duyệt".
  - UI vẫn là Vue/Nuxt — không phải viết lại gì.
- **Tiêu cực / Trade-off:**
  - Phụ thuộc Rust toolchain khi build (không khi chạy).
  - Webview khác nhau giữa OS (WKWebView trên macOS, WebView2 trên Windows, WebKitGTK trên Linux) — cần test cross-platform.
  - Quản lý Node.js sidecar tăng độ phức tạp (spawn, kill, port management).
  - Build pipeline phức tạp hơn web thuần.
- **Việc cần làm tiếp:**
  - ~~Quyết định cách bundle Node.js~~ → đã chốt ở [0007](./0007-bundle-nodejs-runtime.md): bundle kèm binary.
  - ~~Xác định cơ chế giao tiếp với sidecar~~ → đã chốt ở [0008](./0008-stdio-ipc-for-sidecar.md): stdio IPC.
  - ~~Thiết kế tray menu và notification flow~~ → đã đặc tả ở [design/tray-and-notifications.md](../design/tray-and-notifications.md).
  - Cập nhật [tech-stack](../architecture/tech-stack.md) và [system-overview](../architecture/system-overview.md).

## Tham chiếu

- [0003](./0003-nuxt-fullstack.md) (superseded)
- [../architecture/tech-stack.md](../architecture/tech-stack.md)
- [../architecture/system-overview.md](../architecture/system-overview.md)
- [../requirements/non-functional-requirements.md](../requirements/non-functional-requirements.md) (NFR-5, NFR-9)
