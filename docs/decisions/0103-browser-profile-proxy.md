# 0103 — Proxy theo hồ sơ trình duyệt ("VPN" của trình duyệt nhúng)

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-13
- **Người quyết định:** kyro
- **Liên quan:** [ADR 0101](0101-browser-profiles-and-bookmarks.md) (hồ sơ = partition), [ADR 0065](0065-vpn-manager-openvpn.md) (VPN Manager OpenVPN, định tuyến cả máy), [ADR 0018](0018-mcp-secret-keychain.md) (secret trong keychain); spec [browser-profiles-bookmarks.md](../features/browser-profiles-bookmarks.md) mục "Proxy theo hồ sơ"

## Bối cảnh

Người dùng muốn "VPN cho trình duyệt": đổi IP/vùng cho các tab của AWOG mà không đụng mạng cả máy. VPN Manager (ADR 0065) là tunnel OpenVPN định tuyến qua OS ⇒ áp cho MỌI tiến trình, không tách riêng trình duyệt. Mỗi hồ sơ trình duyệt đã là một partition Electron riêng (ADR 0101) ⇒ có sẵn chỗ để gắn tuyến mạng riêng.

## Quyết định

Người dùng chốt (2026-10-13): **proxy theo hồ sơ** (không gắn VpnProfile).

1. **Dữ liệu:** `BrowserProfile.proxy?: { type: 'http'|'https'|'socks5', host, port, bypass?, hasAuth }` trong `profiles.json`. Host loopback/private được phép (client proxy cục bộ là ca phổ biến) — đây là cấu hình của người dùng, agent không có đường nào sửa.
2. **Credential** `{username, password}` chỉ ở OS keychain (`awog-browser-proxy`/id hồ sơ), đi sidecar → main qua host request, main giữ trong RAM; renderer chỉ thấy `hasAuth`/`proxied`. **SOCKS5 + auth bị từ chối ở biên** — Chromium không hỗ trợ.
3. **Áp dụng:** `session.setProxy` trên partition của hồ sơ (+ `<local>` trong bypass) rồi `closeAllConnections()`; xác thực proxy qua `app.on('login')` chỉ khi `isProxy` + đúng partition + đúng host:port, tối đa 3 lần/30s.
4. **Fail-closed:** trước lần đồng bộ đầu, partition chưa biết trạng thái bị chặn; mọi lượt tải do AWOG khởi xướng chờ `proxyReady()` (đồng bộ + `setProxy` xong) để trang đầu của hồ sơ có proxy không đi thẳng.
5. **Kiểm tra:** nút "Kiểm tra" gọi `browser:testProxy` ⇒ một `session.fetch` tới `cloudflare.com/cdn-cgi/trace` qua đúng partition, do người dùng bấm (không chạy ngầm).

## Phương án đã cân nhắc

- **Gắn VpnProfile (OpenVPN) vào hồ sơ** — tunnel định tuyến cả máy, không phải "chỉ trình duyệt"; VPN Manager còn chưa hoàn thiện. Bác.
- **Proxy toàn cục cho mọi hồ sơ** — đơn giản hơn nhưng mất khả năng hồ sơ A đi thẳng, hồ sơ B qua proxy. Bác.
- **Đi thẳng khi chưa đồng bộ (fail-open)** — trình duyệt luôn dùng được kể cả khi engine chết, nhưng hồ sơ có proxy có thể lộ IP thật lúc khởi động. Bác.

## Hệ quả

- Invariant #5 (no telemetry): thêm một host ngoài (`cloudflare.com`) nhưng chỉ khi người dùng bấm Kiểm tra.
- Invariant #7 (SSRF): `hostBlocked` + kiểm DNS của sidecar giữ nguyên; khi có proxy, sidecar phân giải DNS cục bộ còn trang phân giải qua proxy — hai kết quả có thể khác nhau. Đưa vào đợt **infosec re-audit** còn nợ.
- Engine chết lúc khởi động ⇒ mọi hồ sơ bị chặn tới `engine.restarted` (giá của fail-closed).
- Chưa đo: proxy HTTPS thật, NTLM/Digest; đường host request sidecar → main end-to-end trong app thật (harness dùng engine stub).
