# 0008 — Stdio IPC giữa Tauri shell và Node.js sidecar

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-24

## Bối cảnh

[0006](./0006-tauri-shell-for-nuxt.md) chốt kiến trúc Tauri shell + Node.js sidecar. Webview hiển thị UI Nuxt và cần gọi tới execution engine ở sidecar. Có hai cơ chế giao tiếp khả thi:

1. Sidecar mở HTTP server trên một port localhost; webview gọi `fetch` như một SPA bình thường.
2. Sidecar nhận lệnh qua stdin/stdout; Tauri làm cầu nối, expose qua Tauri command cho webview.

## Quyết định

Dùng **stdio IPC** giữa Tauri shell và Node.js sidecar. Sidecar không mở port nào ra ngoài; webview gọi `invoke('engine_call', …)` qua Tauri command, Tauri Rust forward yêu cầu sang sidecar qua stdin và đọc kết quả qua stdout.

```
Webview (Nuxt UI)
    │  invoke('engine_call', { method, args })
    ▼
Tauri Shell (Rust)
    │  ghi message JSON xuống stdin của sidecar
    ▼
Node.js Sidecar
    │  xử lý → ghi response JSON ra stdout
    ▼
Tauri Shell (Rust)
    │  trả về cho webview
    ▼
Webview
```

Streaming (token stream từ model, trace event) đi qua một channel Tauri event: sidecar ghi event xuống stdout với type `stream`, Tauri emit ra webview qua `listen('engine_event', …)`.

## Phương án đã cân nhắc

- **HTTP localhost + random port** — Quen thuộc với dev Nuxt; có thể test sidecar bằng curl. Nhược điểm:
  - Lộ port ra interface loopback — phần mềm khác trên máy có thể chạm tới.
  - Cần xử lý port collision khi user mở nhiều instance.
  - Cần cơ chế auth giữa webview và sidecar để tránh process khác giả webview.
  - Khởi động chậm hơn vì phải bind port.
- **Unix domain socket / named pipe** — An toàn hơn HTTP, nhưng phức tạp cross-platform (Windows named pipe API khác Unix socket), và Tauri không có hỗ trợ first-class.
- **Stdio IPC (đã chọn)** — Tauri có hỗ trợ first-class qua `Command::new().spawn()` với stdin/stdout pipe. Không lộ port, không cần auth, cross-platform đồng nhất.

## Giao thức

- **Định dạng:** JSON-RPC 2.0 trên stdout/stdin, mỗi message một dòng (NDJSON).
- **Request:** `{ jsonrpc, id, method, params }` từ Tauri → sidecar.
- **Response:** `{ jsonrpc, id, result }` hoặc `{ jsonrpc, id, error }` từ sidecar → Tauri.
- **Notification (streaming):** `{ jsonrpc, method: 'event', params: { type, payload } }` từ sidecar → Tauri, không có id, không cần ack.
- **Stderr** dành riêng cho log của sidecar (Tauri tail và ghi vào file log của app).

## Hệ quả

- **Tích cực:**
  - Không port — không collision, không expose loopback, không cần auth riêng.
  - Vòng đời sidecar gắn chặt với Tauri: Tauri exit → stdin close → sidecar self-exit (qua handle 'close').
  - Test sidecar độc lập dễ: chạy `node sidecar.js`, gõ JSON-RPC từ stdin.
  - Cross-platform đồng nhất, không phân biệt Unix/Windows.
- **Tiêu cực / Trade-off:**
  - Khi dev Nuxt UI thuần (không qua Tauri), không gọi được engine — phải dùng mock layer hoặc bật cờ "dev HTTP" tạm thời.
  - Stdout của sidecar **không được** dùng cho `console.log` debug — phải route mọi log sang stderr.
  - Throughput stdio không bằng HTTP/2 cho lưu lượng lớn — không phải vấn đề ở quy mô MVP.
- **Việc cần làm tiếp:**
  - Định nghĩa schema RPC method ban đầu (engine_list_tasks, engine_run_task, engine_subscribe_trace, …).
  - Layer client TypeScript trên `invoke`/`listen` để UI gọi như typed function.
  - ~~Build một dev-mode fallback (HTTP)~~ → đã chốt ở [0009](./0009-dev-mode-http-fallback.md).
  - Thiết kế cơ chế backpressure cho streaming event (token stream của LLM có thể rất nhanh).

## Tham chiếu

- [0006](./0006-tauri-shell-for-nuxt.md)
- [0007](./0007-bundle-nodejs-runtime.md)
- [Tauri sidecar pattern](https://v2.tauri.app/develop/sidecar/)
- [JSON-RPC 2.0 spec](https://www.jsonrpc.org/specification)
