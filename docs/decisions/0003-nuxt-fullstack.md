# 0003 — Nuxt 4 làm frontend + server hợp nhất

- **Trạng thái:** Superseded by [0006](./0006-tauri-shell-for-nuxt.md)
- **Ngày:** 2026-05-23

## Bối cảnh

AWOG cần đồng thời một UI giàu chức năng (workflow editor trực quan, edit code, duyệt file) và logic server-side (filesystem, Git, gọi API model, execution engine). Muốn một runtime duy nhất để deploy app cảm giác như desktop ở local thật đơn giản.

## Quyết định

Dùng **Nuxt 4** làm framework hợp nhất. UI là Vue 3; server nằm tại `server/api/` của Nuxt; cả hai chạy chung một process Node.js.

## Phương án đã cân nhắc

- **Electron + frontend React riêng** — Nặng; đóng gói Chromium; khó mở rộng server API gọn.
- **SPA tách rời + backend Node.js riêng** — Hai process, config nhiều hơn, không lợi gì cho dùng local.
- **Tauri + backend Rust** — Binary nhỏ hơn nhưng learning curve dốc và giới hạn hệ sinh thái (SDK Anthropic/OpenAI nhắm Node/Python).

## Hệ quả

- **Tích cực:**
  - Một codebase, một runtime, một bước deploy.
  - Dễ chia sẻ TypeScript type giữa client và server.
  - Hệ sinh thái trưởng thành (Pinia, VueFlow, Monaco đều phối hợp tốt).
- **Tiêu cực / Trade-off:**
  - Gắn với hệ sinh thái Vue; người đóng góp React có learning curve.
  - Phụ thuộc Node.js phía người dùng cuối (giảm nhẹ bằng đóng gói sau này).
- **Việc cần làm tiếp:**
  - Quyết định chiến lược đóng gói (ví dụ `pkg`, shell Tauri, hoặc "BYO Node").

## Tham chiếu

- [../architecture/tech-stack.md](../architecture/tech-stack.md)
- [../architecture/system-overview.md](../architecture/system-overview.md)
