# 0001 — Lưu trữ filesystem local-first (không database trong MVP)

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-23

## Bối cảnh

AWOG cần persist agent, skill, workflow, task, artifact và session. Các phương án trải từ database cục bộ (SQLite) tới service cloud. Cần hỗ trợ dùng offline, backup dễ và quyền sở hữu dữ liệu hoàn toàn cho người dùng.

## Quyết định

MVP sẽ lưu **toàn bộ** state dưới dạng file thuần (JSON, YAML, Markdown) trong một thư mục `workspace/` do người dùng chọn. Không database. Không cloud service.

## Phương án đã cân nhắc

- **SQLite** — Query mạnh, nhưng thêm một binary file người dùng không dễ inspect hay diff, và làm phức tạp versioning bằng Git.
- **Cloud backend (Postgres + API)** — Cho phép đa người dùng nhưng đi ngược tầm nhìn local-first và bắt buộc quản lý account.
- **IndexedDB trong trình duyệt** — Gắn dữ liệu với một browser profile; portability kém.

## Hệ quả

- **Tích cực:**
  - Backup tầm thường (copy thư mục).
  - Người dùng sở hữu dữ liệu hoàn toàn.
  - Git có thể version mọi thứ tự động.
  - Không có migration phải quản lý.
- **Tiêu cực / Trade-off:**
  - Không có relational query; phải scan thư mục.
  - Ghi đồng thời cần xử lý kỹ (thiết kế single-process giảm nhẹ điều này).
  - Hiệu năng có thể giảm với hàng nghìn task — chấp nhận được ở quy mô MVP.
- **Việc cần làm tiếp:**
  - Xác định chiến lược versioning schema trên đĩa trước V2.
  - Lên kế hoạch migration path nếu sau này thêm SQLite index tùy chọn.

## Tham chiếu

- [../architecture/workspace-layout.md](../architecture/workspace-layout.md)
- [../requirements/non-functional-requirements.md](../requirements/non-functional-requirements.md) (NFR-1, NFR-2)
