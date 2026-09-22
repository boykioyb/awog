# 0091 — Logtime ghi worklog qua MCP, không viết adapter cho từng PMS

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-21
- **Người quyết định:** tech-lead (chốt cùng user)

## Bối cảnh

Người dùng khai giờ công mỗi ngày, trần 8h, trên nhiều dự án thuộc **nhiều hệ PMS khác nhau** — mỗi hệ một trang web, một tài khoản. Cuối ngày là ngồi nhớ lại rồi gõ tay vào từng chỗ; hôm quên thì tuần sau dựng lại từ commit log.

Ba dữ kiện quyết định hình dạng lời giải:

1. **Các PMS nội bộ đều đã có MCP server.** Đo được trên máy: `pms.papay.vn/mcp` có đủ nhóm `worklog_*`, `pms.spacelinks.vn/mcp` thì không (chỉ `issue_*` / `document_*` / `comment_*`).
2. **AWOG đã có hạ tầng nguồn MCP** — Sources ([ADR 0025](./0025-connections-manager.md)) với token nằm trong OS keychain ([ADR 0018](./0018-mcp-secret-keychain.md)), SSRF guard, per-source permission gate.
3. **Ghi worklog là thao tác ra ngoài** trên hệ thống thật của công ty, không được phép tự động.

Câu hỏi cần chốt: Logtime nói chuyện với PMS bằng đường nào, và dữ liệu nháp sống ở đâu.

## Quyết định

**D-1. Mọi lời gọi tới PMS đi qua MCP của chính nguồn đó, dùng lại Sources.** Logtime không giữ token, không tự mở HTTP client, không có file cấu hình endpoint riêng. Nguồn là `SourceConfig` đã có; Logtime chỉ tham chiếu `sourceId`.

**D-2. Năng lực dò bằng `tools/list`, không hard-code adapter từng PMS.** Logtime định nghĩa 7 năng lực và ánh xạ sang tên tool theo quy ước `worklog_*`:

| Năng lực | Tool | Bắt buộc |
|---|---|---|
| Liệt kê dự án | `worklog_list_projects` | ✅ |
| Ghi giờ | `worklog_create` | ✅ |
| Liệt kê task | `worklog_list_tasks` | — |
| Đọc lại ngày | `worklog_list` | — |
| Sửa / Xoá / Đọc 1 dòng | `worklog_update` · `worklog_delete` · `worklog_get` | — |

Thiếu tool bắt buộc ⇒ nguồn ở chế độ **chỉ đọc**, UI nói rõ thiếu gì. Thêm PMS mới = đặt tên tool theo quy ước, **không sửa code AWOG**.

**D-3. Nháp sống ở AWOG, nguồn sự thật là PMS.** Một dòng công có 3 trạng thái `draft` → `posted` (có `worklogId`) → `locked` (PMS đặt `lockedAt`). AWOG không bao giờ tự coi mình đúng hơn PMS: `logtime.pull` kéo `worklog_list` về và ghi đè trạng thái.

**D-4. Lưu 1 file JSON cho mỗi tháng** tại `~/.awog/logtime/<YYYY-MM>.json`, cấu hình ở `~/.awog/logtime/settings.json`. Global-only, **không 2 tier** — giờ công thuộc về *người*, không thuộc về project (một ngày gồm nhiều project là ca thường).

**D-5. Đẩy luôn cần người xác nhận, và gọi tuần tự.** Hộp thoại hai bước: xem trước payload từng dòng → tích ô xác nhận → nút mới mở khoá. Gọi `worklog_create` **tuần tự** chứ không `Promise.all`: lỗi giữa chừng phải biết đúng dòng nào hỏng, và không dội N request vào PMS cùng lúc.

**D-6. Trần giờ cưỡng chế ở store, không ở component.** Một cổng `addEntry` duy nhất; mọi đường thêm dòng (form, gợi ý, chép ngày trước, AI) đều qua đó. Vượt mức thì cắt cho vừa và nói ra, đủ rồi thì từ chối.

**D-7. Mức giờ / bậc làm tròn / giờ nhắc là cấu hình, không hằng số.** Bậc nhỏ nhất 0.25h vì `worklog_create` chặn `hours ≥ 0.25`.

**D-8. Phiên chat tương tác được, nhưng không đẩy được.** Bộ tool `logtime_day` / `logtime_projects` / `logtime_add` / `logtime_remove` có trên cả hai runtime (Pi AgentTool + SDK MCP `awoglogtime`), dùng CHUNG handler. Tool ghi đi qua `addEntryGated` — cùng cổng trần giờ với UI — và qua cổng quyền từng lời gọi. **Cố ý không có `logtime_push`**: nó sẽ là đường vòng qua D-5.

**D-9. Mọi lần ghi phát `logtime.changed`** (`{date, month, source}`), nên trang đang mở tự nạp lại khi agent hoặc đồng bộ PMS đổi dữ liệu — thay vì người dùng nhìn số cũ mà không biết.

## Phương án đã cân nhắc

- **Adapter HTTP riêng cho từng PMS** (đọc REST API trực tiếp) — từ chối: phải tự quản token cho mỗi hệ (đúng thứ [ADR 0018](./0018-mcp-secret-keychain.md) đã giải), phải viết + bảo trì một adapter mỗi khi công ty thêm hệ, và bỏ phí phần MCP các team đã làm sẵn.
- **Cho agent một tool đẩy PMS** — từ chối: xem D-8. Đẩy là thao tác ra ngoài; một tool như thế biến "người bấm nút" thành "model quyết định", đúng thứ D-5 tồn tại để chặn.
- **Gọi PMS qua agent (LLM tự bắn tool)** — từ chối cho đường ghi: không tất định, tốn token cho một việc thuần CRUD, và "model tự ghi lên hệ thống công ty" là đúng thứ D-5 muốn chặn. LLM vẫn dùng được ở P2 để **soạn** nháp, nhưng đẩy thì do người bấm.
- **Một file JSON cho mỗi ngày** — từ chối: 365 file/năm, và báo cáo tháng phải mở 30 file.
- **SQLite** — từ chối: MVP không thêm database (quy ước repo), và dữ liệu này nhỏ + mỗi lần đọc là cả tháng.
- **Lưu 2 tier như wiki/memory** — từ chối: xem D-4, giờ công không thuộc về project.
- **Đồng bộ hai chiều tự động** — từ chối: nháp đang gõ dở bị PMS ghi đè là mất việc; kéo về phải là hành động có chủ ý.

## Hệ quả

- **Tích cực:** thêm PMS mới không tốn dòng code nào nếu nó theo quy ước tên tool; token vẫn nằm trong keychain và không có đường nào mới rò ra; một nơi soạn cho mọi hệ; trần 8h không thể lách bằng cách bấm nhiều lần.
- **Tiêu cực / Trade-off:**
  - Quy ước tên tool là **hợp đồng ngầm**. PMS nào đặt tên khác (`timesheet_create` chẳng hạn) sẽ không được nhận diện dù có đủ chức năng. Chấp nhận trong P1; nếu xuất hiện ca thật thì thêm bảng ánh xạ tên trong `settings.json`.
  - Hai máy cùng sửa một tháng thì máy ghi sau thắng (ghi atomic nhưng không merge). Chấp nhận vì nguồn sự thật là PMS.
  - `hours` PMS trả về là **chuỗi**, phải parse lại — lệch kiểu giữa gửi và nhận là mặt phải sống chung.
- **Việc cần làm tiếp:**
  - P2: gợi ý dòng công từ phiên + tác vụ AWOG trong ngày; soạn bằng AI qua `<logtime_context>`.
  - Xin scope `holiday:read` + `leave:read` cho token PMS → tự đặt mức 0h cho ngày lễ/nghỉ phép (tool đã có sẵn, chỉ thiếu quyền).
  - infosec review khi mở thêm đường ghi (hiện chỉ `worklog_create`; `update`/`delete` đã wire ở sidecar nhưng UI chưa dùng).

## Tham chiếu

- [Feature: Logtime](../features/logtime.md)
- [ADR 0025 — Connections Manager](./0025-connections-manager.md)
- [ADR 0018 — MCP secret trong keychain](./0018-mcp-secret-keychain.md)
- [ADR 0060 — Sources model](./0060-connections-adopt-craft-sources-model.md)
