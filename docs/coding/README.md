# Coding Guide

Quy ước viết code cho AWOG, tách theo từng lớp công nghệ.

| Tài liệu | Phạm vi |
|---|---|
| [general.md](./general.md) | Nguyên tắc chung, TypeScript, đặt tên, tài liệu, Git — áp dụng mọi nơi |
| [nuxt-frontend.md](./nuxt-frontend.md) | Nuxt 4 + Vue 3 + Pinia + VueFlow + TailwindCSS (UI desktop) |

> **Sắp có** khi các phần tương ứng được implement:
> - `node-sidecar.md` — Node.js sidecar (Nuxt server API + execution engine + model adapters)
> - `tauri-shell.md` — Tauri Rust shell (tray, notification, lifecycle, IPC)

## Thứ tự ưu tiên khi mâu thuẫn

1. ADR ở [../decisions/](../decisions/) — quyết định có chủ đích, ưu tiên cao nhất.
2. Tài liệu trong thư mục này.
3. Convention mặc định của framework.

Khi bạn thấy code hiện tại đi ngược lại tài liệu này: đó có thể là technical debt cần sửa, hoặc convention đã thay đổi. Mở thảo luận trước khi sửa hàng loạt.
