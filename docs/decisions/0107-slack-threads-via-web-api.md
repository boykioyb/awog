# 0107 — Slack threads gọi thẳng Slack Web API bằng token của nguồn Slack

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-16
- **Người quyết định:** tech-lead (chốt cùng user)

## Bối cảnh

Tính năng [Slack threads](../features/slack-threads.md) cần đọc thread (tin, user, reaction, file), trả lời, react, sửa/xoá tin của mình, tải file đính kèm, và đưa thread vào phiên AI. Giao diện phải giống Slack: avatar, gộp tin, chip mention, reaction có danh sách người react, chấm chưa đọc theo `ts`.

Dữ kiện đo ngày 2026-10-16 trên workspace Malme:

1. AWOG đã có nguồn Slack (Sources, [ADR 0060](./0060-connections-adopt-craft-sources-model.md)) kết nối qua OAuth tới MCP chính thức `mcp.slack.com`. Token lưu trong keychain (`awog-source-oauth`) là **user token `xoxp-…`** của một Slack app người dùng tự tạo.
2. Token đó gọi được Web API `https://slack.com/api/*` (`auth.test`, `conversations.replies`, `users.list` đều `ok`). Gọi `conversations.replies` 4 lần liên tiếp không bị 429 — app nội bộ, không thuộc diện giới hạn 1 req/phút áp cho app phân phối ngoài Marketplace.
3. Scope đang có thiếu `files:read` và `emoji:read`. Token không kèm refresh token.
4. Tool MCP `slack_read_thread` trả văn bản đã format — mất `ts`, user id, reaction, file id.

## Quyết định

**D-1. Gọi thẳng Slack Web API từ sidecar, mượn token của nguồn Slack** qua `getFreshToken`. Không tạo token/cấu hình riêng. Thiếu scope ⇒ báo người dùng bật scope trong Slack app rồi kết nối lại nguồn; tính năng xuống cấp (không emoji tuỳ chỉnh, không file) thay vì hỏng.

**D-2. Allowlist host ra ngoài:** `slack.com` chỉ cho Web API, URL dựng nội bộ (`callSlackApi`). URL lấy từ payload Slack (file, thumbnail, avatar, emoji) là L1: chỉ `files.slack.com` với path khớp `^/files-(pri|tmb)/T…-F…(-<hash>)?/` và không chứa `%2f`/`%5c`/`%2e` được gắn token; `files.slack.com` path khác và `*.slack-edge.com` gọi không token; host khác, kể cả `slack.com`, bị chặn — nếu không, một file có `url_private` trỏ vào `slack.com/api/...` sẽ khiến sidecar gọi Web API bằng token người dùng. `redirect: 'manual'`; mỗi bước redirect áp lại đúng luật đó (invariant #5, #7).

**D-3. Token không rời sidecar.** File, thumbnail, avatar đi qua sidecar (cần header `Authorization`) và trả về data URI hoặc đường dẫn cache. Renderer không bao giờ nhận URL `url_private`.

**D-4. Mọi thao tác ghi lên Slack do người bấm.** Gửi, sửa, xoá, react chỉ có RPC gọi từ UI. Agent có duy nhất tool `slack_draft_reply` — điền nháp vào ô trả lời, không gửi (cùng lý do [ADR 0091](./0091-logtime-worklog-via-mcp.md) D-8). `chat.postMessage` không tự retry vì không idempotent.

Nháp agent không mang được cú pháp điều khiển: `<!channel>`/`<!here>`/`<!everyone>`/`<!subteam^…>` và `<url|nhãn>` thành chữ đọc được ở sidecar (`neutralizeDraftTokens`) và lần nữa ở renderer (`mrkdwnToDraft` chỉ giữ `<@U…>`). Bản dịch chỉ khôi phục token có trong nguồn (placeholder); `<…>` model tự tạo bị mã hoá. Chỉ đường sửa tin của chính người dùng giữ nguyên mọi token có sẵn.

Phiên đã từng nhận nội dung Slack (chữ người ngoài viết nằm trong transcript, model đọc lại MỌI lượt) bị đóng thêm các đường vòng:

- **Cờ nhiễm bền.** `slack.session.open/push` ghi id phiên vào `~/.awog/slack/tainted-sessions.json` TRƯỚC khi giao khối (ghi hỏng ⇒ không giao). Cờ chỉ thêm, không gỡ — kể cả khi gỡ thread; fork (`sessions.upsert` create có `parentSessionId`) thừa kế cờ. Không đặt ở header phiên vì header bị `sessions.upsert` (create) dựng lại từ payload renderer. Đọc file lỗi/hỏng ⇒ coi MỌI phiên là nhiễm (fail closed, file không bị cách ly). Phiên đang gắn thread cũng tính là nhiễm.
- **Loại nguồn MCP Slack.** Nguồn Slack trong Sources (chính nguồn mà tính năng mượn token) có tool gửi tin/react. Phiên tạo từ thread nhận `mcpServerIds` tường minh = mặc định của project trừ mọi nguồn Slack — `provider === 'slack'`, URL host `*.slack.com` (kể cả `mcp.slack.com`), hoặc server stdio có chữ `slack` trong command/args/tên biến env — không để `undefined` vì `undefined` nghĩa là "mọi nguồn đang bật". `sessions.sendMessage` chốt thêm cho phiên nhiễm: không bao giờ nhận nguồn Slack, dù whitelist về sau có nó.
- **Kẹp quyền mọi lượt.** `slack.session.open` hạ `execute`/`accept-edits`/vắng ⇒ `ask`. `sessions.sendMessage` với phiên nhiễm, ở MỌI lượt: bỏ `autoApprove`, kẹp `execute`/`accept-edits` về `ask`, SSH `auto` về `prompt` (`plan` giữ nguyên). Kẹp sau mọi overlay (agent, `llmOverride`) và trước khi settings vào runtime nên cả Pi, Claude SDK lẫn Codex nhận cùng giá trị (cổng chung `makeBeforeToolCall`, `approvalPolicy` của Codex). Người dùng muốn chạy tự duyệt thì làm ở phiên khác — không nới được trong phiên đã nhận chữ người ngoài.

**D-5. Nội dung Slack vào phiên là dữ liệu L1.** Khối thread bọc rào có nonce sinh lúc dựng, qua `redactString`, có trần độ dài — cùng khuôn `github/pr-watch-block.ts`. Mọi kiểu ngắt dòng (`\r`, CRLF, VT, FF, NEL, U+2028, U+2029) đổi thành `\n` rồi thụt như dòng tiếp theo; id trong `<@…>`/`<#…>`/`:emoji:` chỉ tra khoá riêng (`Object.hasOwn`), `constructor`/`__proto__` không làm hỏng khối. Reply mới không tự đẩy vào phiên, không wake; người dùng bấm "Đưa vào session". Phiên nhận khối bị đánh dấu nhiễm trước khi giao (D-4).

**D-6. Lưu global ở `~/.awog/slack/`** (thread thuộc về người, không thuộc project). Cache file: trần 200 MB/file, dọn file không mở quá 30 ngày.

**D-7. `media://` thêm một root cố định** `~/.awog/slack/files` (khai ở main process, không đọc từ URL) để xem video/audio đã tải mà vẫn giữ kiểm tra traversal/symlink.

## Phương án đã cân nhắc

- **Đọc qua tool MCP (`slack_read_thread`)** — từ chối: payload là văn bản, mất cấu trúc cần cho UI (reaction, file, ts so sánh chưa đọc). Ghi qua MCP cũng không có `chat.update`/`reactions.remove`.
- **Token riêng nhập ở Settings** — từ chối cho v1: bắt người dùng quản lý thêm một bí mật trong khi token nguồn Slack đã dùng được. Giữ làm đường lui nếu Slack đổi chính sách token MCP.
- **Socket Mode / Events API cho realtime** — từ chối: cần app-level token + bot, nặng hơn nhiều so với poll 20s/60s cho vài chục thread.
- **Cho agent tool gửi/react** — từ chối: xem D-4.

## Hệ quả

- **Tích cực:** không cấu hình thêm; dữ liệu đủ cấu trúc để dựng UI giống Slack; token và file nằm trong sidecar.
- **Tiêu cực / Trade-off:** thêm host ra ngoài mới (`slack.com`, `*.slack-edge.com`); phụ thuộc token MCP tiếp tục dùng được cho Web API; token không refresh ⇒ hết hạn phải kết nối lại.
- **Việc cần làm tiếp:** infosec rà allowlist host, đường đi token, proxy file/avatar, root `media://` mới, khối dữ liệu vào phiên và tool `slack_draft_reply`. Scope mặc định của preset (`SLACK_MCP_USER_SCOPES`) đã có `files:read`; nguồn nào đã ghim `mcp.oauthParams.user_scope` hẹp hơn thì phải thêm scope đó + bật trong Slack app rồi kết nối lại. `emoji:read` không chọn được ở User Token Scopes (đo 2026-10-16) nên coi là tuỳ chọn.

## Tham chiếu

- [docs/features/slack-threads.md](../features/slack-threads.md)
- [ADR 0060](./0060-connections-adopt-craft-sources-model.md), [ADR 0018](./0018-mcp-secret-keychain.md), [ADR 0091](./0091-logtime-worklog-via-mcp.md)
- Slack Web API: `conversations.replies`, `chat.postMessage`, `reactions.add`, `files.info`
