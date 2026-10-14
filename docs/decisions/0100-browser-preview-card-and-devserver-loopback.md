# 0100 — Thẻ xem trước trang trong step + ngoại lệ loopback cho dev server đang chạy

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-13
- **Người quyết định:** kyro
- **Liên quan:** [ADR 0043](0043-browser-tool-embedded-chromium.md), [ADR 0086](0086-embedded-browser-panel.md), [ADR 0097](0097-claude-transcript-as-session-source.md), [ADR 0099](0099-anthropic-claude-native-runtime.md); spec [browser-preview-card.md](../features/browser-preview-card.md), [dev-server.md](../features/dev-server.md), [session-browser-panel.md](../features/session-browser-panel.md)

## Bối cảnh

Claude Desktop hiện một thẻ (ảnh trang + tiêu đề + host + nút Open) ngay trong luồng khi agent mở một trang. Ở AWOG, muốn biết agent đang nhìn gì phải mở tab Browser của panel. Ca dùng chính của người dùng là dev server local (`localhost:5199`), nhưng trình duyệt agent chặn MỌI loopback/private (`hostBlocked`, invariant #7 chống SSRF) nên agent không mở được trang đó.

## Quyết định

1. **Thẻ xem trước** cho `browser_tool` `navigate` / `tab_new` có URL:
   - Electron chụp tab sau khi tải (`browser.thumbnail`: JPEG ≤640px rộng, q70, lỗi ⇒ `null`, không làm hỏng tool).
   - Ảnh + `{url,title,tabId}` lưu ở `~/.awog/sessions/<sid>/thumbs/<key>.{jpg,json}`; đọc qua RPC `sessions.browserPreview` có gate đường dẫn (sanitize sessionId, chặn symlink, trần 512KB). **Không bao giờ** vào tool result gửi model hay vào transcript ⇒ 0 token thêm.
   - Khoá = **tool_use id** (cũng là step id lúc live và lúc replay JSONL theo ADR 0097). Handler SDK MCP in-process không nhận tool_use id (SDK 0.3.296) ⇒ PreToolUse hook ghi "vé" (id ↔ action+url+tab) sau khi cổng quyền cho phép, handler nhận vé; Pi dùng thẳng `execute(toolCallId)`.
   - `SessionStep.browserPage` suy từ input của step ⇒ thẻ sống qua reload mà không lưu gì thêm vào transcript.
   - UI `SessionBrowserCard.vue`: kéo ra khỏi nhóm "N steps" để thấy ngay; **Mở** = kích hoạt tab đó ở panel Browser, tab đã đóng ⇒ mở URL ở tab mới của panel; ⋮ = mở bằng trình duyệt của người dùng / sao chép URL.
2. **Ngoại lệ loopback duy nhất:** trình duyệt agent được tới `localhost`/`127.0.0.1`/`[::1]` đúng **cổng của dev server vừa khai trong `.awog/dev-servers.json` vừa đang chạy trong CHÍNH phiên đó**. Sidecar đẩy tập cổng sang main khi dev server start/stop, khi shell nền thoát và trước mỗi `navigate`/`tab_new`; đẩy lỗi ⇒ main giữ tập cũ/rỗng (fail-closed), sidecar crash/restart ⇒ xoá sạch. Mọi đích loopback/private khác — cổng khác, redirect sang cổng khác, frame, popup, phiên khác, node task — vẫn chặn. Danh sách site của người dùng vẫn áp chồng lên.

## Phương án đã cân nhắc

- **Giữ chặn mọi loopback** — an toàn nhất nhưng mất đúng ca dev server.
- **Cho mọi localhost** — agent đọc được mọi dịch vụ local (DB admin, API nội bộ) ⇒ bác.
- **Ảnh nhúng base64 trong tool result** — đơn giản nhưng tốn token mỗi lần và phình transcript ⇒ bác.

## Hệ quả

- **Tích cực:** thấy trang agent vừa mở ngay trong luồng, không tốn token; xem trước được dev server của dự án. Kèm sửa lỗi cũ: `URL.hostname` trả `[::1]` có ngoặc nên guard so với `::1` chưa từng khớp; nay chuẩn hoá và chặn thêm `::`, `::ffff:*`.
- **Tiêu cực / Trade-off:**
  - Cổng là cổng **khai báo**, không dò: tiến trình local nào chiếm đúng cổng đó trong lúc server "đang chạy" đều tới được.
  - Hai lệnh navigate giống hệt nhau chạy song song có thể tráo vé ⇒ hai thẻ cùng URL tráo ảnh.
  - Runtime Codex chưa nối ⇒ thẻ không có ảnh.
  - `BrowserController.thumbnail()` và luồng nút Mở chưa chạy trong app thật (chỉ Electron `capturePage` riêng + CLI thật với host stub).
- **Việc cần làm tiếp:** **infosec re-audit** cho đổi văn bản invariant #7 ở `.claude/rules/security.md` (thêm câu ngoại lệ) và cho RPC `sessions.browserPreview`.
