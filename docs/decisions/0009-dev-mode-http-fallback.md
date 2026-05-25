# 0009 — Dev-mode HTTP fallback cho sidecar

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-24

## Bối cảnh

[0008](./0008-stdio-ipc-for-sidecar.md) chọn stdio IPC cho production: webview gọi engine qua Tauri command, Tauri forward xuống Node.js sidecar qua stdin/stdout. Mô hình này yêu cầu mọi yêu cầu UI đi qua process Tauri.

Trong quá trình phát triển, dev thường muốn chạy `nuxt dev` để hot reload UI (HMR, Vue Devtools, edit-and-refresh dưới một giây). Nhưng `nuxt dev` chạy ngoài Tauri — `window.__TAURI__` không tồn tại, `invoke()` không có đầu nhận. Nếu không có cơ chế dự phòng, mỗi lần sửa UI phải rebuild Tauri → mất hết lợi ích HMR.

## Quyết định

Sidecar hỗ trợ **hai transport** đằng sau cùng một engine API:

1. **Stdio (mặc định, production)** — như [0008](./0008-stdio-ipc-for-sidecar.md).
2. **HTTP dev (chỉ bật khi dev)** — sidecar bind `127.0.0.1:<port>` và phục vụ cùng JSON-RPC method qua POST + SSE.

Client TypeScript trong Nuxt phát hiện môi trường và chọn transport phù hợp:

```
if (window.__TAURI__) → invoke()/listen() (stdio qua Tauri)
else                  → fetch()/EventSource() (HTTP dev)
```

UI code gọi `engine.runTask(...)` như typed function — không biết transport nào đang dùng.

## Cách bật HTTP dev

- Sidecar khởi động ở chế độ HTTP chỉ khi có biến môi trường `AWOG_DEV_HTTP=1` **hoặc** flag CLI `--dev-http`.
- Production binary của Tauri spawn sidecar **không** truyền flag này → HTTP không bao giờ chạy ở bản release.
- Bind cố định loopback `127.0.0.1`, không bao giờ `0.0.0.0`.
- Sinh một dev token ngẫu nhiên khi khởi động, in ra terminal. Mọi request HTTP cần header `X-Awog-Dev-Token: <token>`. Tránh process khác trên máy giả Nuxt dev.

## Phương án đã cân nhắc

- **Không có dev mode, chỉ build Tauri** — DX rất kém: HMR mất, lặp lại slow. Bị bác.
- **Luôn dùng HTTP, kể cả production** — Đã bác ở [0008](./0008-stdio-ipc-for-sidecar.md) vì lộ port và cần auth phức tạp.
- **Mock layer trong dev (không gọi engine thật)** — Lập trình UI sướng nhưng không test được integration thực; thường lệch khỏi hành vi thực tế.
- **Hai transport, chỉ dev mới bật HTTP (đã chọn)** — DX tốt cho UI dev, không hy sinh bảo mật production.

## Hệ quả

- **Tích cực:**
  - Hot reload Nuxt UI hoạt động đầy đủ khi chạy `nuxt dev`.
  - Có thể test engine bằng `curl` / Postman trong giai đoạn dev.
  - Một engine API, hai transport — không phải maintain hai code path nghiệp vụ.
  - Bản release Tauri vẫn 100% stdio, không lộ port.
- **Tiêu cực / Trade-off:**
  - Transport abstraction thêm một lớp trừu tượng vào codebase.
  - Phải đảm bảo flag dev không vô tình lọt vào build production (cần CI guard).
  - Streaming qua SSE và qua stdio notification có ngữ nghĩa hơi khác nhau (reconnect, backpressure) — cần test cả hai.
- **Việc cần làm tiếp:**
  - Thiết kế transport interface trong sidecar: `RpcTransport` với `start()`, `send()`, `onMessage()`.
  - Thiết kế client TS: `createEngineClient()` tự detect Tauri vs HTTP.
  - CI check: production build có `AWOG_DEV_HTTP` được set không (fail nếu có).
  - Document quy trình dev trong README cho người onboard mới.

## Tham chiếu

- [0006](./0006-tauri-shell-for-nuxt.md)
- [0008](./0008-stdio-ipc-for-sidecar.md)
- [Nuxt dev server / HMR](https://nuxt.com/docs/getting-started/introduction)
