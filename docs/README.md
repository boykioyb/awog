# Tài liệu AWOG

Tài liệu cho **AWOG — Artifact Workflow Orchestrate Guild**, một AI Team Operating System theo hướng local-first.

> Xem [VISION](../artifacts/VISION.md) để nắm tầm nhìn sản phẩm đầy đủ.

## Cấu trúc

| Thư mục | Mục đích |
|---|---|
| [requirements/](./requirements/) | Yêu cầu sản phẩm tổng quát (functional, non-functional, ràng buộc) |
| [features/](./features/) | Đặc tả theo feature, mỗi tài liệu cho một module |
| [design/](./design/) | Tài nguyên thiết kế: UX flow, wireframe, visual reference |
| [architecture/](./architecture/) | Kiến trúc hệ thống: component, data flow, runtime, storage |
| [decisions/](./decisions/) | Architecture Decision Records (ADR) — mỗi quyết định quan trọng một bản ghi |
| [coding/](./coding/) | Quy ước code — `general.md` (cross-stack) + `nuxt-frontend.md` (UI) |

## Quy ước

- Dùng Markdown (`.md`) cho mọi tài liệu.
- Tên file: `kebab-case.md` (ví dụ `agent-builder.md`).
- ADR đánh số: `NNNN-title.md` (ví dụ `0001-local-first-storage.md`).
- Liên kết chéo giữa các tài liệu bằng relative path.
- Mỗi tài liệu tập trung vào một chủ đề duy nhất.

## Vòng đời tài liệu

1. **Requirements** — mô tả *cái gì* và *tại sao*.
2. **Design** — khám phá *trông và cảm nhận như thế nào*.
3. **Architecture** — định nghĩa *được xây dựng ra sao*.
4. **Decisions** — ghi lại *vì sao chọn hướng đi này*.
5. **Features** — đặc tả chi tiết cho từng feature cụ thể.
