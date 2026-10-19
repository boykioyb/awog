# 0108 — Lịch chạy được chạy lệnh (job `command`) có sổ duyệt trong Keychain

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-18
- **Người quyết định:** kyro
- **Liên quan:** [ADR 0082](0082-scheduled-runs.md) (lịch chạy — đảo một nguyên tắc của nó); spec [scheduled-runs.md](../features/scheduled-runs.md#command--chạy-một-lệnh-không-qua-ai)

## Bối cảnh

Người dùng cần một việc định kỳ **không có AI**: chạy script đồng bộ các tag GitHub/Discord đang chờ trả lời vào board AWOG, mỗi 15 phút. Hai lối có sẵn đều không hợp:

- `session-prompt` đi qua model ⇒ tốn một lượt mỗi lần chạy, sinh phiên rác, và AI thấy output.
- Cài launchd/cron ngoài app ⇒ người dùng từ chối: không muốn cài gì native vào máy.

ADR 0082 cố ý **không** cho lịch mang path/command/argv ("không có đường nào để một file lịch bị sửa tay trỏ runtime vào thư mục bất kỳ"). Quyết định này đảo điểm đó, nên phải bù bằng cơ chế duyệt.

## Quyết định

1. **Job mới `command`**: `program` (đường dẫn tuyệt đối, phải thực thi được lúc lưu), `args[]` (≤ 32), `timeoutMinutes` (1–60, mặc định 10). Sidecar chạy bằng `spawn` mảng tham số, không shell, `cwd = home`, không lượt LLM nào.
2. **"Đã duyệt" không nằm trong file lịch.** File lịch là L1, và một agent có quyền Write tự cấy được lịch `command` ⇒ chạy lệnh vòng qua mọi cổng quyền. Sidecar giữ **sổ duyệt trong Keychain** (`awog-schedules` / `approved-commands`): `id lịch → sha256(id, program, args, timeout, sha256 nội dung của program và mọi arg là file tuyệt đối)`. Runner tính lại digest ngay trước khi chạy; lệch ⇒ từ chối.
3. **Chỉ một đường ghi sổ**: `schedules.upsert` có `approve: true`, mà UI chỉ gửi sau hộp xác nhận liệt kê program + **mỗi arg một dòng**. Bật/tắt đi RPC riêng `schedules.setEnabled` (chỉ đổi cờ, không nhận `job`) — trước đây nút bật/tắt gửi lại nguyên `job` đọc từ đĩa, tức là "lưu hộ" một lệnh lạ bằng một cú click. Xoá lịch ⇒ thu hồi dòng sổ.
4. **Tiến trình con**: env đã gỡ `*_TOKEN|*_KEY|*_SECRET` + cờ runtime của host (`util/child-env.ts`, dùng chung với terminal và CLI registry); process group riêng (`detached`), hết giờ SIGTERM cả nhóm rồi SIGKILL sau 5s, xong việc dọn cháu còn sót, sidecar tắt thì giết mọi nhóm còn sống. Dòng cuối của output (đã redact) vào lịch sử chạy.
5. **Agent đề xuất được lịch, không tạo được lịch chạy.** Tool `propose_schedule` (chỉ phiên chat; Pi + Codex qua bộ tool Pi, Claude SDK qua server `awogsurfaces`) ghi một lịch **tắt** mang `proposedBy`: runner bỏ qua kể cả khi file nói `enabled`, "Chạy ngay" từ chối, `schedules.setEnabled` từ chối bật. Người dùng mở Sửa → Lưu (`schedules.upsert` dựng lại lịch nên `proposedBy` rơi mất; job `command` qua thêm hộp duyệt). Phiên mới dùng model/tài khoản của phiên đề xuất, mode `plan`. Trần 3 đề xuất/lượt, 10 đề xuất chờ duyệt toàn app.
6. **Agent không ghi được `.awog/schedules/` và `.awog/hooks/`.** Permission gate (phiên chat và task) chặn cứng Write/Edit/Bash đụng hai thư mục này (`touchesAwogAutomation`, cùng lớp với `PROTECTED_PATH_RE`) — trước đây một file lịch `session-prompt` do agent ghi sẽ chạy agent ở mode `execute` theo giờ, không ai duyệt. Giá phải trả: agent không tự viết hook được nữa; người dùng tạo hook ở trang Hooks.
7. **Board tự làm mới khi bị ghi từ ngoài**: watcher thêm kind `boards` (`~/.awog/boards`, depth 0) phát `board.changed { projectId }`; ghi của chính sidecar (≤ 2s, `isOwnBoardWrite`) bị lọc để không refetch đôi.

## Phương án đã cân nhắc

- **HMAC của (program, args) lưu trong file lịch** — bản đầu. Infosec bác: không phủ nội dung script (agent sửa script là xong), dấu chép được sang lịch khác, không thu hồi được, và nút bật/tắt tự ký lại. Thay bằng sổ duyệt.
- **Allowlist thư mục chứa script** — chặn nhầm script hợp lệ (skill nằm trong `~/.claude`, chỗ agent cũng ghi được); hash nội dung bắt đúng thứ cần bắt hơn.
- **Ký ở Electron main bằng hộp thoại gốc của hệ điều hành** — chống được cả renderer bị XSS, nhưng cần thêm IPC + UI ở main. Để mở (xem Hệ quả).

## Hệ quả

- Sửa script đồng bộ (vd cập nhật skill) ⇒ lịch thành "Chưa duyệt" tới khi người dùng mở Sửa → Lưu → duyệt lại. Chủ ý.
- **Giới hạn đã biết**: file mà script đọc/import bắc cầu (module Python, file cấu hình) không nằm trong digest. Keychain lỗi lúc đọc bị coi như sổ rỗng ⇒ duyệt khi đó ghi đè sổ (các lịch khác phải duyệt lại — fail closed).
- **Còn nợ infosec**: mọi renderer có preload đều gọi được `schedules.upsert` với `approve: true` (`electron/src/ipc.ts` không kiểm `event.sender`) — một XSS trong renderer thành lệnh chạy định kỳ. Hướng: ký ở main bằng hộp thoại gốc, hoặc chỉ `mainWindow` được gọi `schedules.*`.
- Hàng rào ở mục 6 là **độ sâu**, không kín: với `Bash` chỉ so chuỗi, một script tự ghép đường dẫn vẫn lọt; tool riêng của Codex (sửa file trong sandbox của nó) không đi qua gate này. Chốt thật là agent không có quyền ghi `~/.awog` ngay từ đầu.
