# 0105 — Danh mục proxy miễn phí cho hồ sơ trình duyệt

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-13
- **Người quyết định:** kyro
- **Liên quan:** [ADR 0103](0103-browser-profile-proxy.md) (proxy theo hồ sơ), [ADR 0101](0101-browser-profiles-and-bookmarks.md) (hồ sơ = partition); spec [browser-profiles-bookmarks.md](../features/browser-profiles-bookmarks.md) mục "Proxy miễn phí"

## Bối cảnh

Proxy theo hồ sơ (ADR 0103) cần người dùng tự có `host:port`. Người dùng muốn AWOG tự tìm proxy miễn phí, lọc theo vùng và độ trễ, rồi áp vào một hồ sơ. Danh sách công khai có sẵn nhưng chất lượng thấp: đo lúc làm (2026-10-13) chỉ 10/40 proxy đứng đầu theo uptime của nguồn thực sự mở được đường hầm, độ trễ 616–4981ms.

## Quyết định

1. **Nguồn cố định (L3):** ProxyScrape v4 + Geonode, hai URL hằng trong `sidecar/src/browser-profiles/free-proxies.ts`, gọi song song (timeout 15s/nguồn), một nguồn chết không làm hỏng cả lượt. Gộp + dedupe theo `type://host:port`, cache RAM 10 phút.
2. **Lọc ở biên sidecar:** chỉ HTTP + SOCKS5 (hồ sơ không có SOCKS4); bỏ `transparent` (lộ IP thật); chỉ IPv4 công khai — loopback/private/link-local/CGNAT/multicast bị loại, để một danh sách độc không biến AWOG thành máy dò LAN; validate lại bằng `proxy-config.ts`.
3. **Đo bằng đường hầm THẬT + TLS, từ máy người dùng:** `freeProxies.probe` (≤60 id, phải nằm trong catalog hiện tại — UI không gửi được host tuỳ ý) mở tunnel (`CONNECT` / SOCKS5 CONNECT theo tên miền) rồi **làm TLS handshake qua tunnel** với xác thực chứng chỉ + SNI; độ trễ = tới lúc TLS xong. Tunnel 200 KHÔNG đủ — đo thật 2026-10-13: proxy lối ra Trung Quốc trả 200 nhưng TLS tới `www.google.com.hk` bị reset ⇒ trang lỗi `ERR_CONNECTION_RESET`. Lỗi: `tls-reset` (mạng kiểm duyệt / proxy hỏng), `tls-cert` (proxy giải mã TLS — MITM). Mỗi proxy đo song song thêm `www.google.com`: qua được cloudflare mà không qua được google ⇒ vẫn "chạy" nhưng gắn `blocked: ['google']`, UI hiện nhãn "Chặn Google" và xếp sau. Timeout 5s, song song 12, kết quả stream qua event `freeProxies.probed`; lượt mới huỷ lượt cũ. Độ trễ của nguồn chỉ dùng để chọn ứng viên, không hiển thị như số đo.
4. **UI:** tab "Proxy miễn phí" trong editor proxy (Settings và nút quả địa cầu cạnh ☆ trên thanh địa chỉ): banner cảnh báo, lọc quốc gia (có số lượng) + loại, bảng điền dần sắp theo độ trễ đo được, **Dùng** cho hồ sơ đang sửa hoặc **Tạo hồ sơ riêng rồi dùng**.

## Phương án đã cân nhắc

- **Chỉ hiện độ trễ của nguồn** — nhanh, không mở socket nào, nhưng số đó đo từ máy của nguồn và không nói proxy có còn sống không (~75% chết khi đo lại). Bác.
- **Ping/TCP connect** — rẻ hơn handshake nhưng cổng mở ≠ proxy chạy (đo được: ECONNREFUSED 7, HTTP 400/500, SOCKS từ chối). Bác.
- **Proxy trả phí / VPN thật** — chất lượng tốt hơn hẳn nhưng cần tài khoản; người dùng tự nhập qua tab Thủ công như cũ.

## Hệ quả

- **Rủi ro cho người dùng (nói rõ trên UI):** proxy do người lạ vận hành — HTTPS vẫn mã hoá nhưng họ thấy mọi tên miền, đọc/sửa được trang HTTP thường; cookie/đăng nhập của hồ sơ chỉ còn TLS bảo vệ ⇒ khuyến nghị hồ sơ riêng không đăng nhập.
- Invariant #5: thêm 2 host danh sách + handshake tới các proxy được liệt kê, CHỈ khi người dùng bấm. Invariant #7: lọc IP private ở biên. Agent không có tool nào chạm tới. Đưa vào đợt **infosec re-audit** còn nợ.
- Catalog chỉ trong RAM sidecar: engine khởi động lại thì phải bấm tìm lại trước khi đo.
