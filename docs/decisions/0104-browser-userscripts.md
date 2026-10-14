# 0104 — Userscript kiểu Tampermonkey cho trình duyệt nhúng

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-13
- **Người quyết định:** kyro
- **Liên quan:** [ADR 0086](0086-embedded-browser-panel.md) (trình duyệt nhúng `WebContentsView`), [ADR 0101](0101-browser-profiles-and-bookmarks.md) (hồ sơ); spec [browser-userscripts.md](../features/browser-userscripts.md)

## Bối cảnh

Người dùng muốn "nạp script như Tampermonkey" — tự chạy JS trên trang khớp URL (thay cho ý định autoclick ban đầu: một userscript làm được autoclick và nhiều thứ khác). Electron không chạy extension Chrome đầy đủ (MV3 + Tampermonkey cần `chrome.*` API mà Electron chỉ hỗ trợ một phần), nên tự hiện thực phần lõi: metadata `==UserScript==`, khớp URL, thời điểm chạy.

## Quyết định

1. **Lưu ở sidecar**, toàn cục (mọi hồ sơ): `~/.awog/browser/userscripts/<id>.user.js` + `index.json` (bật/tắt); ≤512KB/script, ≤200 script. RPC `userscripts.*` (list/get/save/setEnabled/remove/importUrl/snapshot), event `userscripts.changed`.
2. **Metadata hỗ trợ:** `@name` `@namespace` `@version` `@description` `@match` `@include` `@exclude` (`@exclude` thắng) `@run-at` (start/end/idle, mặc định end) `@noframes` `@grant`. Grant hỗ trợ: `none`, `GM_addStyle` (lùi về `adoptedStyleSheets` khi CSP chặn `<style>`), `GM_info`, `unsafeWindow`. **Không có** `GM_xmlhttpRequest`/`@require` (cố ý — không mở đường mạng cross-origin cho script); script vẫn lưu nhưng mang `warnings`.
3. **Khớp URL một nguồn:** sidecar biên dịch luật thành regex; main chỉ chạy regex đã biên dịch trong `node:vm` có timeout 25ms (regex thảm hoạ không treo main).
4. **Tiêm vào PAGE world** (giống `@grant none`): CDP `Page.addScriptToEvaluateOnNewDocument` (cần `Page.enable`) với wrapper kiểm URL/`@noframes`/run-at; lỗi báo về main qua `console.debug` có tag ngẫu nhiên theo tiến trình và bị lọc khỏi console ring của agent. Không có debugger ⇒ `executeJavaScript` lúc `dom-ready`. Không tiêm vào trang không phải http(s), app AWOG, `wspreview://`.
5. **Không cho agent tạo/sửa script** ở đợt này. `importUrl` chỉ https, qua `assertSafeUrl` mỗi hop (≤3 redirect), cap 512KB, timeout 15s.

## Phương án đã cân nhắc

- **Nạp extension Tampermonkey thật** (`session.loadExtension`) — Electron thiếu nhiều `chrome.*` API Tampermonkey cần; hành vi không đoán được. Bác.
- **Isolated world** — an toàn hơn cho trang nhưng script không thấy biến JS của trang, khác Tampermonkey `@grant none` mà đa số script giả định. Bác.
- **Hỗ trợ `GM_xmlhttpRequest`** — nhiều script cần, nhưng là kênh mạng cross-origin bỏ qua CORS và SSRF guard của trang. Hoãn tới khi có allowlist `@connect` + audit.

## Hệ quả

- Script chạy cả trên trang **agent** duyệt ⇒ có thể đổi nội dung agent đọc; UI cảnh báo, chỉ thêm script tin tưởng.
- Hạn chế đo được: lượt điều hướng **đầu tiên** của tab mới chưa được đăng ký CDP kịp ⇒ `document-start` chạy muộn (sau script của trang) ở trang đầu; document-end/idle vẫn đúng; từ lượt thứ hai trở đi đúng.
- Bề mặt mới cho **infosec re-audit**: tiêm JS vào page world, `importUrl`.
