# Nhập phiên từ Claude Desktop / CLI

> Phiên làm trong Claude Desktop (Code) hoặc `claude` ở terminal không hiện trong AWOG, nên Logtime thiếu phần việc đó. Tính năng này cho người dùng **nhập thủ công** các phiên đó thành phiên AWOG dạng pointer-mode (ADR 0097). ADR: 0102.

## Dữ liệu và luật (sidecar)

**Nguồn:** `<claudeHome>/projects/<cwd-slug>/<uuid>.jsonl` (`claudeHome()` honour `CLAUDE_CONFIG_DIR`). Mỗi dòng user mang `entrypoint`: `claude-desktop` (Desktop), `cli` (terminal), `sdk-ts` (Agent-SDK của chính AWOG — **loại**, đã là phiên AWOG khoá bằng `Session.sdkSessionId`). Entrypoint lạ khác cũng loại. Chỉ file nằm trực tiếp trong thư mục slug (không đi vào `subagents/`), symlink bị bỏ.

**`claudeSessions.list { days? }`** (mặc định 30, tối đa 180; lọc theo mtime file) → `{ items, skipped: { noProject, unreadable } }`. Giữ phiên có cwd (realpath, **longest-prefix**) nằm trong một project AWOG; cwd ngoài mọi project → `skipped.noProject`; file lỗi I/O hoặc chỉ có dòng entrypoint hỏng → `skipped.unreadable`. Sắp `lastAt` giảm dần, cap 300. Mỗi item có `importedSessionId` nếu đã nhập (tra theo `sdkSessionId`).

- Tiêu đề = dòng `custom-title` **cuối**; không có thì 80 ký tự đầu của tin user thật đầu tiên; cuối cùng `"Claude session"`.
- `userTurns` là số **ước lượng** (kiểm tra chuỗi con, loại tool_result/meta/sidechain/compact-summary), không parse từng dòng.
- `firstAt`/`lastAt` = timestamp dòng user/assistant đầu/cuối (parse chính xác ở hai đầu).
- Quét: file không khớp (sdk-ts chiếm đa số) chỉ đọc tới dòng đầu có `entrypoint`; file khớp đọc tuần tự khối 1MB, JSON.parse chỉ vài dòng; cache theo `(path,size,mtime)`. Dòng hỏng chỉ bị bỏ qua, không làm đổ lần quét.

**`claudeSessions.import { ids ≤ 50 }`** → `{ imported: [{id, sessionId}], skipped: [{id, reason}] }`. Reason: `invalid-id` (không phải UUID), `already-imported`, `not-found`, `not-desktop-or-cli`, `no-project`, `empty`, `unreadable`. Idempotent; một id hỏng không phá cả lô. Mỗi phiên tạo ra là **pointer-mode** (ADR 0097): `provider anthropic`, `sdkSessionId = uuid`, `sdkSessionPath`, `transcriptSource: 'sdk'`, `createdAt/updatedAt = firstAt/lastAt`, model lấy từ lượt assistant cuối (mặc định `claude-opus-5`), cộng `importedFrom { kind, at, cwd }` (header field mới, mirror lên `SessionSummary.importedFrom`). Phát `session.created`.

**Chống trùng:** khoá = **uuid phiên Claude** (tên file `<uuid>.jsonl` = `sessionId` trong transcript), so với `Session.sdkSessionId` của mọi phiên AWOG (cả phiên AWOG tự tạo). So không phân biệt hoa thường; các lượt nhập **xếp hàng** (bản chụp index ở đầu lượt + nhiều `await` trước khi đăng ký ⇒ hai lượt song song từng tạo HAI phiên cho một uuid — test chạy song song bắt được, nay 1). Xoá phiên AWOG đã nhập ⇒ nhập lại được (phiên mới). Desktop/CLI tạo uuid MỚI (fork, "new session") ⇒ là phiên khác, không bị coi là trùng dù nội dung đầu giống nhau.

**`sessions.upsert`** chỉ ghi qua patch nên `importedFrom` (cùng các field pointer) được giữ nguyên khi UI lưu tên/ghim (có test).

### Làm tươi hoạt động (Logtime)

Logtime lọc phiên theo `updatedAt` trong ngày (`logtime/suggestions.ts`). Phiên nhập có thể được làm tiếp ở Desktop/CLI **sau** lúc nhập, nên `listSessionSummariesFresh()` (dùng bởi `logtime.suggestions`, `logtime.compose`, `sessions.list`) và `sessions.get` gọi `refreshImportedSessions` trước: `stat` transcript; nếu mtime đổi **và** vượt `updatedAt` quá 2s thì đọc 1MB cuối để lấy timestamp của dòng user/assistant **cuối** (không dùng mtime — CLI còn ghi `last-prompt`/`custom-title` sau lượt cuối). Có lượt mới ⇒ `updatedAt` = timestamp đó (phiên chưa nạp messages: chỉ cập nhật trong RAM; đã nạp: replay lại + persist). Hạn chế đã biết: như phiên native, phiên chỉ gợi ý ở **ngày hoạt động cuối** (`updatedAt`), không ở mọi ngày nó có việc.

### Tiếp tục phiên + cổng `CLAUDE_SESSION_BUSY`

Phiên nhập dùng chung file với Desktop/CLI; hai tiến trình cùng `--resume` sẽ ghi xen vào một file. `sessions.sendMessage` và `sessions.compact` (`sessions/claude-busy-guard.ts`) ném `RpcError(-32021, 'CLAUDE_SESSION_BUSY: …')` khi **mtime transcript < 120s trước VÀ AWOG không có tiến trình CLI sống (`liveFor`) cho phiên**. Có tiến trình sống của AWOG ⇒ các lần ghi gần đây là của mình; im ≥ 120s ⇒ coi như bên kia đã đóng. Đây là heuristic (không có cách tin cậy biết app khác còn mở file): hệ quả chấp nhận là huỷ giữa lượt rồi gửi lại trong 2 phút cũng bị chặn. Lượt chạy dùng lại `importedFrom.cwd` làm cwd (khi không có `workspacePath`) vì CLI tìm file resume theo slug của cwd, mà cwd gốc có thể là thư mục **con** của project.

### Số đo (máy dev, read-only, `~/.claude/projects` 1.9GB / 469 file / 350 sdk-ts)

`claudeSessions.list`: 30 ngày → 80 phiên, **543ms** lần đầu (cache nguội), **11ms** lần sau; 180 ngày → 88 phiên (14 `noProject`), 27ms/9ms.

## UX (ui-next)

**Lối vào** (cả hai mở cùng một modal, trạng thái ở `composables/useClaudeImportModal.ts`, host trong `AppGlobalHosts`):

- Workbench → explorer **Sessions** → nút icon tải xuống ở hàng đầu (title "Nhập phiên từ Claude").
- Trang `/sessions` → menu `⋯` của cột danh sách → "Nhập phiên từ Claude" (header ở đó chỉ vừa ba điều khiển nên không thêm nút thứ tư).

**Modal `components/session/ClaudeImportModal.vue`:**

- Mỗi lần mở gọi `claudeSessions.list { days }`; chọn 7/30/90 ngày thì tải lại (phản hồi cũ bị bỏ qua nếu bấm nhanh).
- Gom theo project (mới hoạt động nhất lên trên). Mỗi dòng: checkbox · tiêu đề · badge nguồn Desktop/CLI · nhánh git · số lượt user · thời điểm hoạt động cuối. Checkbox ở đầu nhóm = chọn tất cả (tri-state); chỉ tính các dòng chưa nhập.
- Dòng đã nhập (`importedSessionId`) bị khoá, nhãn "Đã nhập". Ô lọc khớp tiêu đề/nhánh/project (bỏ dấu).
- Chân modal nêu số phiên bị bỏ qua (`skipped.noProject`/`unreadable`), số đã chọn, nút **Nhập N**.
- Nhập xong: toast số phiên đã nhập (+ số bị bỏ qua nếu có), xoá chọn, tải lại danh sách (dòng vừa nhập chuyển "Đã nhập"); modal **không** mở phiên nào. Store (`importClaudeSessions`) đọc lại `sessions.list` và thêm hàng mới vào danh sách phiên.

**Badge nguồn:** phiên có `importedFrom` hiện chip `Desktop`/`CLI` ở hàng danh sách (`SessionListItem`) và icon tải xuống có tooltip ở hàng gọn của explorer Workbench (`SessionsView`). KHÔNG hiện ở thanh ngữ cảnh đầu phiên (`SessionContextStrip`) — chip ở đó trông như nút bấm mà không làm gì, người dùng hỏi "nút này làm gì?" ⇒ đã bỏ (2026-10-13).

**Lỗi `CLAUDE_SESSION_BUSY` (-32021):** gửi tiếp / `/compact` vào phiên đã nhập mà có thể đang mở ở nơi gốc. Store thay thông điệp tiếng Anh của sidecar bằng i18n `sessions.claudeImport.busy` — "Phiên này có thể đang mở trong Claude Desktop/CLI — đóng nó ở đó (hoặc chờ 2 phút) rồi gửi lại" — qua cả hai đường (reject của RPC và event `done`, gộp ở `pushErrorBlock`).

**i18n:** `i18n/locales/{en,vi}/sessions-claude-import.json` (khoá `sessions.claudeImport.*`).
