# 0007 — Bundle Node.js runtime cùng binary

- **Trạng thái:** Accepted — **Superseded by [ADR 0027](./0027-tauri-vs-electron-revisit.md)** (2026-06-05).
- **Ngày:** 2026-05-24

> **Cập nhật 2026-06-05:** Không còn bundle Node runtime độc lập — Electron mang sẵn Node của nó; engine chạy qua `ELECTRON_RUN_AS_NODE`. Cách bundle Node riêng (download từ nodejs.org + launcher) đã bị gỡ bỏ. Xem [ADR 0027](./0027-tauri-vs-electron-revisit.md) + [docs/features/electron-migration.md](../features/electron-migration.md).

## Bối cảnh

[0006](./0006-tauri-shell-for-nuxt.md) chốt kiến trúc Tauri shell (Rust) + Node.js sidecar chạy Nuxt server và execution engine. Khi cài AWOG lên máy người dùng cuối, sidecar cần một Node.js runtime để chạy. Người dùng mục tiêu của AWOG bao gồm cả non-developer (marketing, legal, tax, research) — không thể giả định họ có Node.js sẵn hoặc biết cách cài.

## Quyết định

**Bundle Node.js runtime kèm app**. Người dùng tải về một installer duy nhất, double-click là chạy được, không cần cài đặt phụ thuộc nào.

## Phương án đã cân nhắc

- **Yêu cầu người dùng cài Node.js trước** — App gọn (~20MB) nhưng tạo rào cản lớn với non-dev. Trải nghiệm "install rồi mới install" không thể chấp nhận với target user.
- **Bundle Node.js (đã chọn)** — App nặng thêm ~50MB nhưng cài-một-bước, chạy ngay.
- **Viết lại engine sang Rust** — Loại bỏ hoàn toàn Node.js, nhưng phá vỡ hệ sinh thái SDK (Anthropic/OpenAI/Vue/Nuxt). Đã bị bác ở [0006](./0006-tauri-shell-for-nuxt.md).

## Cơ chế bundle

Hai hướng khả thi, sẽ thử nghiệm và chọn trong giai đoạn implement:

- **`node-sea`** (Single Executable Applications, Node.js chính thức) — Tạo một binary duy nhất gồm Node runtime + code. Là tiêu chuẩn upstream, nhẹ hơn `pkg`.
- **Copy `node` binary làm resource của Tauri** — Đơn giản, dễ debug, dễ update Node version. Tauri spawn `./resources/node server.js`.

Cả hai đều đạt mục tiêu: người dùng không cần cài Node.

## Hệ quả

- **Tích cực:**
  - Cài đặt một bước, không phụ thuộc bên ngoài.
  - Kiểm soát chính xác Node version — không bị lệ thuộc Node người dùng đang dùng (v18, v20, v22…).
  - Mở cửa cho non-dev target user.
- **Tiêu cực / Trade-off:**
  - Binary nặng thêm ~40–60MB (Node runtime + native modules).
  - Mỗi platform cần build riêng (Node x86_64 vs arm64 vs Windows vs Linux).
  - Khi muốn update Node để vá lỗ hổng bảo mật, phải re-release app.
  - Native module (như `better-sqlite3`, nếu dùng sau này) phải được build sẵn cho từng platform.
- **Việc cần làm tiếp:**
  - PoC `node-sea` vs Tauri sidecar resource — chọn cách trong sprint đầu.
  - Quyết định pin Node version (LTS) trong build config.
  - Lên matrix CI cho 6 target: macOS arm64/x86_64, Windows x86_64, Linux x86_64 (deb/AppImage).
  - Quy trình release ghi rõ phải bump Node khi LTS update.

## Tham chiếu

- [0006](./0006-tauri-shell-for-nuxt.md)
- [../architecture/tech-stack.md](../architecture/tech-stack.md)
- [Node.js Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
- [Tauri Sidecar pattern](https://v2.tauri.app/develop/sidecar/)
