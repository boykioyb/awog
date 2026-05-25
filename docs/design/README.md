# Design

Tài nguyên thiết kế cho AWOG: UX flow, wireframe, visual language và component reference.

## Nội dung

- [design-principles.md](./design-principles.md) — Nguyên tắc định hướng cho UX và visual design
- [information-architecture.md](./information-architecture.md) — Điều hướng ứng dụng, sơ đồ màn hình
- [ux-flows.md](./ux-flows.md) — Các hành trình người dùng chính (build agent, run task, approve artifact)
- [tray-and-notifications.md](./tray-and-notifications.md) — System tray menu, notification triggers, luồng dữ liệu
- `wireframes/` — Mockup màn hình (thêm dưới dạng `.png` / `.svg` / `.excalidraw`)
- `assets/` — Logo, icon, color palette

## Công cụ

- Wireframe: bất kỳ tool nào export ra PNG/SVG (Figma, Excalidraw, tldraw).
- Source file (`.fig`, `.excalidraw`) commit cùng với bản export khi tiện.

## Quy ước

- Tên file: `kebab-case`.
- Mỗi wireframe tham chiếu feature mà nó thuộc về: `wf-<feature>-<screen>.png`.
- Liên kết chéo từ feature spec tại [../features/](../features/) tới các màn hình tương ứng ở đây.
