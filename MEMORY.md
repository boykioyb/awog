# MEMORY.md — Index ngữ cảnh dự án AWOG

File này là **index** cho ngữ cảnh dài hạn của dự án AWOG mà Claude Code nên ghi nhớ qua các phiên làm việc. Nó **không** thay thế file memory global ở `~/.claude/` — đây là chỉ mục **đặc thù dự án**, dành cho thông tin không suy ra được từ code/git.

> **Quy tắc.** Mỗi mục là một dòng `- [Tiêu đề](đường-dẫn.md) — gợi nhớ ngắn`. Nội dung chi tiết để trong file riêng. Tránh dài quá ~200 dòng (sẽ bị cắt khi load).

## Cách dùng

1. Khi học được điều mới về dự án, người dùng, ràng buộc, lý do thiết kế → tạo file `memory/<slug>.md` với frontmatter (`name`, `description`, `metadata.type`) rồi thêm một dòng ở mục phù hợp bên dưới.
2. Khi memory cũ sai hoặc lỗi thời → update hoặc xóa cả entry lẫn file.
3. Trước khi tin vào memory mô tả file/function cụ thể → verify trong codebase hiện tại.

Phân loại theo `metadata.type`: `user` | `feedback` | `project` | `reference`.

## User

<!-- Thông tin về người dùng: vai trò, mục tiêu, kiến thức nền, sở thích cộng tác -->

_(Chưa có entry)_

## Feedback

<!-- Quy tắc / sở thích đã được người dùng xác nhận trực tiếp -->

_(Chưa có entry)_

## Project

<!-- Tình trạng, mốc thời gian, quyết định đang chạy của dự án — đổi nhanh, cần update -->

- [Trạng thái MVP hiện tại](#) — UI đang port React → Nuxt 4, engine + Tauri shell chưa wire. Mock data trong [stores/](apps/desktop/ui-next/stores/) (tách theo domain).
- [Tài liệu là tiếng Việt](#) — toàn bộ `docs/`, README, comment kỹ thuật viết tiếng Việt; code và identifier giữ tiếng Anh.

## Reference

<!-- Trỏ đến nguồn thông tin bên ngoài: tài liệu nội bộ, dashboard, channel, repo liên quan -->

- [VISION](artifacts/VISION.md) — tầm nhìn sản phẩm đầy đủ
- [Tài liệu chính](docs/README.md) — entry point cho requirements / design / architecture / decisions / features
- [ADR](docs/decisions/) — lý do của mọi quyết định kiến trúc lớn
- [UI overview](docs/architecture/system-overview.md) — kiến trúc + stack frontend, route, store, theme
- [Coding guide](docs/coding/) — quy ước code (general + nuxt-frontend)
- [Claude instructions](CLAUDE.md) — hướng dẫn riêng cho Claude Code

---

> Khi thêm entry mới, **đừng nhúng nội dung dài vào đây.** Tạo file riêng (vd. `memory/feedback-no-mock-fs.md`) và chỉ thêm một dòng tóm tắt + link tại mục tương ứng.
