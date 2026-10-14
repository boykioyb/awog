# 0106 — Network capture cho trình duyệt nhúng (công cụ infosec của người dùng)

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-14
- **Người quyết định:** kyro
- **Liên quan:** [ADR 0086](0086-embedded-browser-panel.md) (trình duyệt nhúng), [ADR 0103](0103-browser-profile-proxy.md) (proxy theo hồ sơ); spec [network-capture.md](../features/network-capture.md)

## Bối cảnh

Người dùng (làm infosec) cần bắt request của một trang bất kỳ với đầy đủ chi tiết: header thô (cả cookie), body, TLS, timing, WebSocket, xuất HAR, copy cURL, gửi lại request đã sửa và gợi ý lỗ hổng thụ động. Mỗi tab đã có debugger CDP gắn sẵn với `Network.enable`, nhưng ring `tab.network` hiện có phục vụ `browser_tool` của agent nên header nhạy cảm bị che và chỉ giữ 300 mục.

## Quyết định

1. **Kho riêng của người dùng, tách khỏi ring của agent.** `electron/src/browser-capture*.ts` nghe cùng luồng CDP qua một móc nhỏ trong `browser.ts`; ring của agent giữ nguyên. Dữ liệu chỉ ở RAM của main + renderer của cửa sổ inspector; không gửi sidecar, không tool cho agent, không ghi đĩa trừ HAR người dùng chọn lưu (file `0600`).
2. **Ghi theo tab, mặc định TẮT**, giữ qua các lần điều hướng tới khi Clear. Trần 5000 entry/tab, body ≤ 5 MB (request ≤ 1 MB), ngân sách 256 MB toàn app (đẩy body cũ nhất).
3. **Header thô từ `*ExtraInfo`** (Cookie, mọi dòng Set-Cookie), redirect tách thành từng hop, timing theo HAR, TLS từ `securityDetails`, frame WebSocket.
4. **Cửa sổ inspector riêng** (route `/network-capture`, một cửa sổ/tab): bảng ảo hoá, chi tiết (Header/Payload/Response/Cookie/Timing/Bảo mật/Nguồn gọi/WS/JWT), copy URL/cURL/fetch/raw, Repeater, Phát hiện. Vào bằng nút trên thanh địa chỉ (chấm đỏ + số khi đang ghi).
5. **Repeater** gửi qua session của partition (proxy của hồ sơ áp dụng) với `credentials: 'omit'` — cookie chỉ là những gì người dùng thấy trong header; URL và mỗi hop redirect qua `hostBlocked` như điều hướng.
6. **Phát hiện thụ động** (thuần, ở renderer): cookie thiếu HttpOnly/Secure/SameSite, thiếu header bảo mật trên document, CORS `*` + credentials, mixed content, credential trong URL, JWT `alg: none`/hết hạn, Basic qua http, lộ phiên bản server, stack trace/SQL error, directory listing, cache thiếu `no-store`.

## Phương án đã cân nhắc

- **Chỉ mở DevTools của Chromium** — có sẵn Network panel nhưng không HAR theo phiên dài, không repeater, không findings, và DevTools tranh debugger với `browser_tool` (attach thất bại khi DevTools mở). Bác làm lối chính; DevTools vẫn mở được như trước.
- **Mở rộng ring của agent** — lộ cookie/token cho model. Bác.
- **Proxy MITM ngoài (kiểu Burp)** — cần CA tự ký cài vào partition, phức tạp và nguy hiểm hơn; CDP đã cho dữ liệu sau giải mã. Bác.

## Hệ quả

- Bề mặt mới cho **infosec re-audit**: kênh IPC `browser:capture:*` (đặc biệt `replay` — một máy gửi request tuỳ ý theo lệnh người dùng, có `hostBlocked`), cửa sổ inspector hiển thị cookie/token thật.
- Giới hạn: response > 8 MB không có body (buffer của `Network.enable`); ExtraInfo khớp hop theo thứ tự (*[INFERENCE]* có thể lệch ở redirect nội bộ); Repeater gộp header trùng tên và Chromium tự thêm vài header.
