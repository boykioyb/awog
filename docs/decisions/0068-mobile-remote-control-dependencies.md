# ADR 0068 — Dependencies cho Mobile Remote Control (ws + qrcode + jsqr)

- **Trạng thái:** Accepted
- **Ngày:** 2026-07-29
- **Người quyết định:** tech-lead (user đã đồng ý thêm dependency QR khi chốt pairing = QR)
- **Liên quan:** [ADR 0067](0067-mobile-remote-control-transport.md) (transport — quyết định gốc), [spec](../features/mobile-remote-control.md), [security.md](../../.claude/rules/security.md) ("thêm dep lớn → cần ADR")

## Bối cảnh

[ADR 0067](0067-mobile-remote-control-transport.md) chốt kiến trúc điều khiển session từ điện thoại: Remote Gateway ở Electron main bridge WebSocket ↔ engine RPC, pairing bằng QR. Repo có quy tắc cứng: **không thêm dependency mới khi chưa có ADR/đồng thuận** (CLAUDE.md + security.md). Grep toàn `apps/desktop` xác nhận **chưa có** thư viện WebSocket lẫn QR nào. Cần chốt 3 dependency:

1. **WebSocket server** ở Electron main (transport của gateway). Node không có WS server built-in.
2. **QR generate** ở ui-next (Settings → Devices hiển thị QR pairing).
3. **QR scan** ở PWA (điện thoại quét QR để pair).

## Quyết định

### 1. `ws` (+ `@types/ws`) — `apps/desktop/electron/package.json`

WebSocket server cho Remote Gateway. Là chuẩn de-facto của Node (hàng chục triệu weekly downloads, MIT, không native binding, maintained tích cực). Đặt ở **electron** vì gateway sống ở main (ADR 0067 §2). Không dùng thay thế native vì Node không có `WebSocketServer` built-in (chỉ có `WebSocket` client từ Node 21, không có server).

### 2. `qrcode` (+ `@types/qrcode`) — `apps/desktop/ui-next/package.json`

Generate QR ở Settings → Devices (render data-URL/canvas). Phổ biến, MIT, pure-JS, không native dep. Dùng để encode payload pairing `{ host, port, code }` thành QR + có sẵn text fallback (mã gõ tay) nên QR chỉ là tiện lợi, không phải điểm chết.

### 3. `jsqr` — `apps/desktop/ui-next/package.json` (dùng ở nhánh PWA)

Decode QR từ khung hình camera (getUserMedia → canvas → `ImageData` → `jsqr`). Chọn `jsqr` (pure-JS, ~nhỏ, MIT) thay vì:

- **`BarcodeDetector` API (0 dep):** Safari/iOS **không hỗ trợ** ổn định → loại vì PWA nhắm cả iOS.
- **`@zxing/browser`:** nặng hơn nhiều, hỗ trợ nhiều format không cần thiết → thừa (YAGNI).

PWA port từ ui-next (cùng package) nên `jsqr` nằm chung `ui-next/package.json`; chỉ import ở route/màn scan.

## Hệ quả

### Tích cực
- Đủ hạ tầng cho gateway (ws) + pairing (qrcode/jsqr) với dep tối thiểu, tất cả MIT + pure-JS/không native binding → không phải rebuild theo platform (khác `node-pty`).
- QR có text-fallback → nếu camera/scan lỗi vẫn pair được bằng mã gõ tay.

### Tiêu cực / trade-off
- 3 dependency mới trên bề mặt bảo mật nhạy cảm → phải qua checklist "thêm dependency" của security.md (npm view author/downloads/repo, `pnpm audit`) trước khi merge.
- `ws` chạy ở main (process không giữ API key) → đúng invariant #1; nhưng là listener mạng → nằm trong phạm vi infosec HARD gate của ADR 0067.

### Việc cần làm
- [ ] `pnpm add ws && pnpm add -D @types/ws` trong `apps/desktop/electron`.
- [ ] `pnpm add qrcode jsqr && pnpm add -D @types/qrcode` trong `apps/desktop/ui-next`.
- [ ] `pnpm audit` sau install; check `npm view` từng package.
- [ ] Commit `pnpm-lock.yaml`.

## Reversibility

Reversible. `qrcode`/`jsqr` chỉ dùng ở màn pairing (có text-fallback → gỡ QR không mất chức năng pair). `ws` gắn với gateway — gỡ gateway thì gỡ luôn `ws`; không đụng đường renderer⇆engine hiện có.
