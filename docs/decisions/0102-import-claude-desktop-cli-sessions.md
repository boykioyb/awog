# 0102 — Nhập phiên Claude Desktop / Claude CLI vào AWOG (thủ công, pointer-mode)

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-13
- **Người quyết định:** kyro
- **Liên quan:** [ADR 0097](0097-claude-transcript-as-session-source.md) (transcript Claude làm nguồn sự thật), [ADR 0099](0099-anthropic-claude-native-runtime.md) (tiến trình CLI sống lâu), [ADR 0091](0091-logtime-worklog-via-mcp.md) (Logtime); spec [claude-session-import.md](../features/claude-session-import.md)

## Bối cảnh

Người dùng đôi khi làm việc trong Claude Desktop (Code) hoặc `claude` ở terminal. Các phiên đó nằm ở `<claudeHome>/projects/<cwd-slug>/<uuid>.jsonl` nhưng không có trong AWOG ⇒ Logtime (gợi ý từ phiên AWOG) bỏ sót công. Đo trên máy người dùng: 469 file / 1,9GB, 350 file là phiên của chính AWOG (`entrypoint: sdk-ts`); file Desktop mang `entrypoint: claude-desktop`, terminal mang `cli`, tiêu đề ở dòng `custom-title`.

## Quyết định

Người dùng chốt (2026-10-13): **nhập thủ công** · nguồn **Desktop + CLI terminal** · **cho chat tiếp nhưng chặn khi có thể đang mở** · cwd không thuộc project nào thì **bỏ qua**.

1. **Quét:** `claudeSessions.list {days}` liệt kê file `claude-desktop`/`cli` (loại `sdk-ts`) có cwd nằm trong một project AWOG (realpath, tiền tố dài nhất), đọc đầu file + tìm `custom-title` cuối/timestamp cuối, có cache; trần 300 mục. Đo: 30 ngày ⇒ 80 phiên, 543ms lạnh / 11ms ấm.
2. **Nhập = phiên pointer-mode** (ADR 0097): `claudeSessions.import {ids}` tạo index AWOG với `sdkSessionId` = uuid gốc, `sdkSessionPath`, project, tiêu đề, mốc thời gian, và header `importedFrom {kind, at, cwd}`. Không chép transcript — lượt làm tiếp ở Desktop/CLI tự hiện khi mở lại. Nhập lại ⇒ `skipped: already-imported`.
3. **Logtime thấy công mới:** `listSessionSummariesFresh()` stat transcript của phiên đã nhập, file mới hơn `updatedAt` > 2s thì đọc 1MB cuối lấy timestamp lượt user/assistant cuối (KHÔNG dùng mtime — CLI ghi `last-prompt`/`custom-title` sau lượt cuối).
4. **Chặn ghi đồng thời:** gửi tin / compact trên phiên đã nhập bị từ chối `RpcError(-32021, 'CLAUDE_SESSION_BUSY…')` nếu transcript được ghi trong 120s gần nhất VÀ AWOG không có tiến trình CLI sống cho phiên đó. Chạy với `importedFrom.cwd` gốc (CLI tìm file resume theo slug của cwd).
5. **UI:** nút "Nhập phiên từ Claude" ở explorer Phiên của Workbench + menu ⋯ của danh sách phiên; modal nhóm theo project (chọn nhiều, lọc, 7/30/90 ngày, dòng đã nhập bị khoá); nhãn nguồn Desktop/CLI trên phiên; lỗi BUSY dịch thành câu tiếng Việt dễ hiểu.

## Phương án đã cân nhắc

- **Tự động đồng bộ (watch thư mục)** — không cần bấm nhưng danh sách phiên tự phình; người dùng chọn thủ công.
- **Logtime đọc thẳng transcript Claude** — không đụng danh sách phiên nhưng không xem/chat tiếp được trong AWOG; bác.
- **Chép transcript sang AWOG** — hai bản lệch nhau đúng như vấn đề ADR 0097 đã gỡ; bác.
- **Khoá độc quyền** thay cho heuristic mtime — AWOG không điều khiển được tiến trình của Desktop; bác.

## Hệ quả

- **Tích cực:** công làm trong Desktop/terminal vào được Logtime và tiếp tục được trong AWOG trên cùng một lịch sử.
- **Tiêu cực / Trade-off:**
  - Heuristic 120s có thể chặn nhầm (vừa huỷ lượt rồi gửi lại trong 2 phút) và không bắt được phiên Desktop mở mà im lặng > 2 phút.
  - Phiên chỉ được tính vào Logtime ở ngày hoạt động CUỐI (giống phiên AWOG gốc).
  - `userTurns` là ước lượng; `readSdkTranscriptMessages` đồng bộ nên transcript rất lớn có thể chặn vòng lặp lúc mở.
  - Thêm một người đọc định dạng nội bộ của Claude CLI (`entrypoint`, `custom-title`) — kiểm lại khi bump SDK/CLI.
