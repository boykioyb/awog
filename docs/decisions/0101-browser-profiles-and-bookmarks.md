# 0101 — Hồ sơ (profile) trình duyệt theo phiên + bookmark thay ghim

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-13
- **Người quyết định:** kyro
- **Liên quan:** [ADR 0043](0043-browser-tool-embedded-chromium.md), [ADR 0086](0086-embedded-browser-panel.md), [ADR 0100](0100-browser-preview-card-and-devserver-loopback.md); spec [browser-profiles-bookmarks.md](../features/browser-profiles-bookmarks.md), [session-browser-panel.md](../features/session-browser-panel.md)

## Bối cảnh

Mọi tab của trình duyệt nhúng (agent + người dùng) dùng chung MỘT partition `persist:awog-browser`: đăng nhập của dự án A lẫn với dự án B, và agent của mọi phiên đọc được mọi phiên đăng nhập. "Ghim trang" (`useBrowserPins`, localStorage, tối đa 12) chỉ là danh sách phẳng chung cho cả app. Người dùng làm nhiều dự án song song, muốn kiểu Chrome: nhiều hồ sơ, bookmark có thư mục, và dự án tự dùng đúng hồ sơ của nó.

## Quyết định

Người dùng chốt 3 điểm (2026-10-13): bookmark THAY ghim · thư mục một cấp · hồ sơ gắn THEO PHIÊN.

1. **Hồ sơ = một partition Electron.** `default` ↔ `persist:awog-browser` (giữ nguyên đăng nhập + dữ liệu đã nhập từ Chrome); hồ sơ khác ↔ `persist:awog-browser-<id>`, id `[a-z0-9-]{1,32}` do sidecar sinh (`partitionForProfile` ở main từ chối id lạ). `ensurePartition` cài cùng bộ handler (chặn quyền, chặn tải xuống…) cho MỖI partition.
2. **Hồ sơ hiệu lực của một scope:** `Session.browserProfileId` ?? `Project.browserProfileId` ?? hồ sơ mặc định của app; `task:<id>:<node>` ⇒ project của task ?? mặc định; pool global ⇒ mặc định. Hồ sơ đã xoá thì bỏ qua, rơi xuống tầng dưới.
3. **Sidecar sở hữu dữ liệu**, main chỉ ánh xạ id → partition: `~/.awog/browser/profiles.json` (`defaultProfileId` + danh sách; `default` luôn có, không xoá được) và `~/.awog/browser/profiles/<id>/bookmarks.json` (url + thư mục một cấp, tối đa 500 mục, chỉ http/https). RPC `browserProfiles.*`, `bookmarks.*`, `sessions.setBrowserProfile`; `Project.browserProfileId` đi qua `projects.upsert` như `githubAccount`.
4. **Đồng bộ scope → hồ sơ:** sidecar đẩy `browser.setScopeProfile` trước MỌI lệnh `browser_tool` và mỗi khi hồ sơ hiệu lực có thể đổi (đặt override phiên, đổi field project, xoá hồ sơ, đổi mặc định). Main cache theo scope; thiếu thì hỏi `browserProfiles.resolveScope`. IPC attach/open/newTab chờ hồ sơ trước khi tạo tab. Đổi hồ sơ của scope ⇒ đóng tab của scope ở partition cũ và mở lại đúng URL, đúng thứ tự, đúng tab đang chọn ở partition mới.
5. **Xoá hồ sơ:** gỡ tham chiếu ở phiên/project → đồng bộ lại scope (tab dời khỏi partition cũ) → RỒI mới `browser.wipeProfile` (xoá storage + cache). Nhập từ Chrome và "Xoá dữ liệu duyệt web" nay theo từng hồ sơ (staging nhập ở `pending-browser-import/<profileId>/`).
6. **UI:** thanh bookmark dưới hàng URL (dùng chung panel / popout / tab chính của phiên / doc web của Workbench), ☆ trong ô URL, menu ⋮ có "Tất cả bookmark" + chọn hồ sơ cho phiên + "Quản lý hồ sơ…", Settings → **Hồ sơ trình duyệt**, trường hồ sơ ở trang tổng quan project. Ghim cũ chuyển một lần vào bookmark của hồ sơ Mặc định (`bookmarks.importPins`, chỉ xoá khoá localStorage khi RPC thành công), sau đó `useBrowserPins`/`BrowserPinStrip` bị xoá.

## Phương án đã cân nhắc

- **Hồ sơ theo từng tab** (như mỗi cửa sổ Chrome) — linh hoạt hơn nhưng agent khó biết đang đọc đăng nhập của ai; bác.
- **Giữ ghim song song bookmark** — hai khái niệm gần trùng; bác.
- **Main tự đọc file hồ sơ** — tách đôi nguồn sự thật với session/project vốn ở sidecar; bác.

## Hệ quả

- **Tích cực:** đăng nhập tách theo dự án; agent của một phiên chỉ thấy cookie của hồ sơ phiên đó — hẹp hơn trước (trước: một partition cho tất cả). Dữ liệu cũ giữ nguyên ở hồ sơ Mặc định.
- **Tiêu cực / Trade-off:**
  - Mỗi lệnh `browser_tool` thêm một vòng host request + đọc `profiles.json`.
  - Tab tạo trước khi biết hồ sơ của scope tạm ở `default` rồi bị dời ⇒ có thể chớp một lần (đường IPC đã chờ hồ sơ nên không bị).
  - Đổi hồ sơ = đóng + mở lại tab: mất trạng thái trang (form đang gõ, lịch sử back/forward).
  - Nhập từ Chrome vào hồ sơ không phải `default` chưa thử trên dữ liệu thật.
- **Việc cần làm tiếp:** infosec re-audit cho partition theo hồ sơ + RPC `browserProfiles.*`/`bookmarks.*` (đường dẫn theo profile id, L1 từ UI).
