# AWOG Desktop (Electron)

Đây là phần vỏ desktop của AWOG, viết bằng Electron. Nó thay cho lớp shell Rust/Tauri cũ: lo cửa sổ app, vòng đời ứng dụng, và làm cầu nối giữa giao diện (Nuxt SPA) với engine xử lý chạy bằng Node.

## Nó làm gì

Process chính (main) khởi động cửa sổ, dựng tray icon, và spawn engine như một tiến trình con. Toàn bộ trao đổi giữa renderer và engine đi qua một router IPC duy nhất — đây là ranh giới bảo mật được kiểm soát, renderer không bao giờ chạm thẳng vào Node hay `ipcRenderer`.

Mấy mảng chính trong `src/`:

- **`main.ts`** — điểm vào, dựng cửa sổ + tray, gắn các module lại với nhau.
- **`window.ts`** — tạo cửa sổ chính, đăng ký scheme `app://` để phục vụ bản Nuxt đã build (kèm SPA fallback cho client-side routing).
- **`engine.ts`** — spawn engine Node ở chế độ `ELECTRON_RUN_AS_NODE`, nói chuyện qua JSON-RPC (NDJSON trên stdin/stdout). Token OAuth nằm trong engine, không lọt ra renderer.
- **`ipc.ts`** — router IPC: gọi engine + một nhóm hẹp các thao tác shell/dialog. `openExternal` chỉ cho phép `https`, `http`, `mailto`.
- **`preload.ts`** — chạy sandbox, expose đúng một object `window.awog` cho renderer.
- **`browser.ts`** — điều khiển một cửa sổ Chromium ẩn cho `browser_tool` của agent, cách ly session và chặn truy cập host nội bộ (chống SSRF).
- **`vscode.ts`** — tìm và mở `code` CLI cho hành động "Open in VS Code".
- **`updater.ts`** — auto-update qua `electron-updater` + GitHub.
- **`shell-env.ts`** — khôi phục PATH thật của user khi app mở từ Finder/Dock (không thì engine không thấy node, ripgrep, git...).
- **`logger.ts`** — ghi log ra file (`electron-log`) vì bản đóng gói không có terminal.
- **`paths.ts`** — phân giải đường dẫn asset cho cả chế độ dev và bản đóng gói.

## Chạy thử

```bash
npm run dev        # chạy ở chế độ phát triển
npm run compile    # build TypeScript
npm run typecheck  # kiểm tra kiểu
npm run dist       # đóng gói app (electron-builder)
```

Engine và UI được ship kèm dạng `extraResources` khi đóng gói. Ở chế độ dev, UI lấy từ Nuxt dev server (mặc định `http://localhost:3031`, đổi bằng biến `AWOG_DEV_URL`).
