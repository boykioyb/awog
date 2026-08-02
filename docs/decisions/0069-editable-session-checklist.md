# 0069 — Checklist của session là shared state giữa user và model

- **Trạng thái:** Accepted
- **Ngày:** 2026-07-30
- **Người quyết định:** tech-lead

## Bối cảnh

[Live Todo List](../features/todo-list.md) ship checklist `TodoWrite` như một **mirror read-only** của ý định model: `TodoWrite` chỉ ACK (không ghi đâu cả), UI derive checklist từ note step mới nhất trong transcript, và banner chỉ hiện **khi turn đang chạy**.

Ba hệ quả thực tế khi dùng lâu:

1. **Mất tầm nhìn đúng lúc cần nhất.** Banner tự ẩn khi turn kết thúc — đúng thời điểm user hỏi "tới đâu rồi". Muốn xem phải cuộn transcript tìm lần `TodoWrite` cuối.
2. **Không sửa được.** Không có button, không có RPC, không có store. Cách duy nhất để cập nhật là nhắn cho model — vòng lặp "hỏi đi hỏi lại" chính là pain point.
3. **Không có nơi để ghi.** Kể cả thêm checkbox vào UI, model chỉ thấy `TodoWrite` **của chính nó** trong context, nên lần gọi kế tiếp sẽ **ghi đè** mất thao tác của user.

Điểm (3) là điểm quyết định: nó không phải vấn đề UI mà là vấn đề kiến trúc. Muốn checklist sửa được thì nó phải thôi là mirror.

## Quyết định

Checklist của session trở thành **shared state** giữa user và model, với **một field authoritative duy nhất**: `Session.todos`.

Ba mảnh bắt buộc, thiếu một mảnh là nút giả:

1. **Store** — `Session.todos` persist trong `SessionHeader` (line 1 của session JSONL). `TodoWrite` nhận `ToolFilter.todoSink` và ghi thật; sink chỉ do chat runtime cấp — Tasks giữ nguyên ACK vì tiến độ của task đã có DAG riêng.
2. **RPC** — `sessions.updateTodos` cho user ghi. Zod là biên validate (payload IPC = L1), cap 200 item × 2000 char.
3. **Context injection** — `<session_checklist>` được inject **mỗi turn** từ list đã persist, đọc từ đĩa (không tin payload client). Block nói rõ với model: đây là state hiện tại, nó thắng `TodoWrite` cuối của model, giữ nguyên item không đổi, không mở lại item user đã tick xong.

Transcript **không đổi**: mỗi `TodoWrite` vẫn là một note step, read-only, là **log lịch sử**. Chỉ list "hiện tại" mới sửa được. Banner + tab Plan đọc list hiện tại; step inline đọc snapshot lịch sử.

Banner cũng thôi tự ẩn: hiện suốt khi session có checklist, mở rộng khi đang chạy, tự thu thành strip một dòng `done/total` khi không.

## Phương án đã cân nhắc

- **Giữ read-only, chỉ sửa hiển thị (không tự ẩn).** Rẻ nhất và đã giải quyết điểm (1). Từ chối vì không giải quyết (2)/(3) — user vẫn phải nhắn model để đổi trạng thái. *(Đã ship trước như bước đi độc lập; ADR này xây tiếp lên.)*
- **Chỉ lưu override của user, merge lúc đọc.** Tránh trùng state. Từ chối: phải khớp item theo `content` (model hay sửa câu chữ) → merge mờ, khó debug, vi phạm KISS.
- **Todo là entity riêng ngoài session (file/ collection riêng).** Từ chối: vi phạm "không thêm database trong MVP" và tách checklist khỏi session vốn là owner tự nhiên của nó.
- **Không inject context, chỉ chặn model ghi đè bằng prompt.** Từ chối: không có cơ chế nào để prompt tham chiếu — model không thấy list đã sửa thì không có gì để giữ.

## Hệ quả

- **Tích cực:**
  - Checklist trả lời được "tới đâu rồi" mà không cần hỏi, cả khi turn đã xong và sau khi restart app.
  - User tick được; thao tác đó tới model ở turn sau thay vì bị ghi đè.
  - Một field authoritative → banner, tab Plan, model đọc cùng một nguồn, không lệch.
  - `Session.todos` đi qua `updateSessionMetadata` nên `createSessionHeader`/`managedToSession` (rest-spread) giữ nguyên qua mọi append message; `sessions.upsert` build patch bằng **explicit pick** nên pin/rename/đổi mode không xoá checklist.

- **Tiêu cực / Trade-off:**
  - Thêm ~1 lần ghi header mỗi `TodoWrite` (đã coalesce qua debounce 500ms của persistence queue).
  - Thêm một block context mỗi turn — cap 60 item × 300 char để không ăn context window.
  - Sửa của user không ràng buộc được model: block là **chỉ dẫn**, không phải cưỡng chế. Model vẫn có thể bỏ qua. Đây là giới hạn có chủ đích — cưỡng chế nghĩa là phải diff/merge `TodoWrite` ở engine, mức phức tạp không tương xứng.
  - Banner và step inline có thể hiển thị khác nhau sau khi user sửa (state hiện tại vs log lịch sử). Đây là **đúng ý**, nhưng cần nhớ khi đọc UI.

- **Việc cần làm tiếp:**
  - Chưa có: thêm/xoá/sửa nội dung item từ UI (hiện chỉ cycle trạng thái).
  - Chưa có: view tổng hợp checklist cấp project (nhiều session + task). Chờ dữ liệu dùng thật rồi quyết — xem "Ngoài phạm vi" của [spec](../features/todo-list.md).
  - Chưa có test tự động cho vòng persist → inject → ghi đè.

## Tham chiếu

- [Live Todo List (TodoWrite)](../features/todo-list.md) — spec feature
- [ADR 0030](0030-subagent-task-tool.md) — Pi runtime + builtin stubs (nơi `TodoWrite` từng chỉ là stub)
- [ADR 0055](0055-session-task-link.md) — tiền lệ inject context mỗi turn (`<linked_task>`)
- [ADR 0062](0062-adopt-craft-session-storage-model.md) — single-file JSONL (header + messages), nơi `Session.todos` persist
