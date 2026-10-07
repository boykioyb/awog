# Feature Brief: Session main tabs — trình duyệt ngang hàng với Trao đổi

> **Status:** Implemented
> **Owner:** Product Owner (hoatq)
> **Created:** 2026-10-07

## Problem

Trình duyệt nhúng của agent ([ADR 0086](../decisions/0086-embedded-browser-panel.md)) hiện không có một "nhà" xứng tầm: mặc định nó là **một view trong workspace panel dock** rộng 322px — quá hẹp để đọc web thật (PR GitHub, tài liệu, dev server preview); kéo giãn cũng chỉ tới ~60% và vẫn mang cảm giác "sidebar lỏng lẻo". Bề mặt dự phòng là **card PiP nổi**, vốn là đường race-prone nhất của embedded browser — comment trong `useBrowserPip.ts` / `WorkspaceBrowser.vue` ghi nhận một chuỗi lỗi bàn giao view (PiP giành view ngay lúc panel vừa mở, lời detach trễ park mất view của chủ mới, "kẹt" cả hai phía). Người dùng vì thế phải chọn giữa **chật** (panel) và **không ổn định** (PiP), hoặc tách hẳn ra **cửa sổ khác** (popout — mất ngữ cảnh session).

## Target user

- **Persona:** Operator chạy session mà agent duyệt web (đọc PR/tài liệu, verify dev server), hoặc tự bấm link trong transcript.
- **Tần suất gặp problem:** Mỗi lần `browser_tool` chạy hoặc mỗi cú bấm link — panel hiện ra ở kích thước sidebar, hoặc PiP nhảy lên.
- **Workaround hiện tại:** Kéo panel rộng ra (vẫn ≤60%), popout sang cửa sổ riêng, hoặc mở thẳng OS browser (mất tích hợp với session).

## Why now

- Embedded browser vừa có đủ 3 bề mặt nhưng **mặc định (panel + auto-PiP) chính là nguồn phàn nàn** — cần quyết định mô hình trước khi PiP sinh thêm lớp vá.
- **Nền kỹ thuật đã sẵn:** `WebContentsView` dán vào một DOM rect, trọng tài một-chủ (`owner`/`shownElsewhere`) và hàng rào `onScreen` đã giải đúng bài toán "bề mặt ẩn thì nhả view" — đưa browser ra main area là thêm một placeholder, không phải viết lại.
- Người dùng đã quen mô hình Orca: **tab trình duyệt ngang hàng với tab hội thoại** — match mental model có sẵn.

## Hypothesis

Nếu trong SessionDetail có một **main tab strip** — `[Trao đổi]` (pin cố định) + mỗi trang web của session là một tab ngang hàng, mở khi user bấm link hoặc agent tạo tab — thì browser chiếm được toàn bộ main area khi cần, hành vi mở link trở nên dễ đoán, và **auto-PiP mất lý do tồn tại** ở luồng mặc định. Đo bằng: tỉ lệ phiên đọc web ở main tab vs panel; số phiên còn bật PiP; số lỗi "view bị giành / vẽ đè DOM" được báo lại.

## Success criteria

- Bấm link `https?` trong transcript (mode `'app'`) ⇒ **tab web mới xuất hiện ngang hàng Trao đổi** và được focus, viewport chiếm toàn bộ main area.
- Agent `tab_new`/`tab_select` ⇒ tab tương ứng hiện trên strip (kèm favicon/title/spinner/đóng — tái dùng chip của `BrowserTabs.vue`).
- **Auto-PiP không còn chạy mặc định** — vai trò "agent đang duyệt mà chưa ai xem" chuyển sang tab mới trên strip; PiP vẫn mở được thủ công (menu ⋮ / `⇧⌘B`) cho ai cần trang nổi.
- Chuyển tab Trao đổi ↔ tab web không phá trang (view native detach/park đúng, giữ login state).
- Không regression: popout window, pin trang, translate strip, screenshot, `browser_tool` scope theo session — tất cả vẫn hoạt động từ main tab.

## Fit with vision

| Tiêu chí | Đánh giá |
|---|---|
| Artifact-driven | Yes — browser là công cụ verify/sinh artifact; tab main cho nó đủ chỗ làm việc đó. |
| Workflow-based | Trung lập — không đổi execution model. |
| Human-in-the-loop | Yes — đây chính là bề mặt "nhìn agent làm việc"; tab model làm việc quan sát rõ ràng hơn. |
| Local-first | Yes — Chromium nhúng local, không đổi. |

## Scope hint

- **v-next**. Layer chạm: gần như **chỉ UI/renderer** — `SessionDetail` (main tab strip + vùng content), `useEmbeddedBrowser` (chế độ bind theo `tabId` cố định thay vì follow `activeByScope`), `useLinkOpen` (reroute `openInApp`), `useBrowserPip` (tắt auto-open mặc định). Không đụng sidecar/`browser_tool` (bridge đã per-tab).
- Ước lượng (PM refine): **M**.

## Out of scope (cho lần này)

- Khái quát `'main'` thành dock side cho mọi view khác (Terminal/Diff/Files lên main) — hướng mở rộng tự nhiên, cân nhắc sau.
- Đổi hợp đồng `browser_tool` hay cách main process quản lý `WebContentsView`.
- Xoá hẳn PiP (quyết định: **giữ opt-in**), popout window vẫn giữ.

## Quyết định ban đầu (PO chốt 2026-10-07 — xem [wireframe](./session-main-tabs.wireframe.html))

- **Mô hình tab:** session là một **tab bar ngang hàng kiểu browser thật** (full-width, tab bo góc trên, dính liền content — KHÔNG phải strip con trong vùng chat). Mỗi tab là một "task" có loại: tab `Trao đổi` (loại `discuss` — transcript + composer tương tác với model) pin đầu tiên không đóng; mỗi trang web = một tab `browser` ngang hàng. Về sau strip có thể nhận thêm loại tab khác (terminal, preview…) mà không đổi khung.
- **Agent tự mở tab:** tab mới hiện trên strip kèm spinner/badge, **không chiếm focus** — đây chính là thứ thay thế auto-PiP.
- **Bấm link trong transcript** (mode `'app'`): tab mới mở + focus luôn (user vừa bấm — hành vi dễ đoán).
- **Navbar (back/forward/URL/⋯) chỉ render khi tab `browser` active** — thanh địa chỉ thuộc về tab web, tab `discuss` không có.
- **View `Browser` dock 3 mép giữ lại** cho side-by-side; tranh chấp view đã có elsewhere/takeover phân xử.
- **PiP giữ opt-in** (menu ⋮ / `⇧⌘B`); `browserAutoPip` đổi default → **off**.
- **Tab bar luôn hiện** dưới session header, trong cột giữa (dock trái/phải/dưới ôm như cũ); overflow → scroll ngang.
- **Header gộp một hàng:** chips ngữ cảnh của `SessionContextStrip` (task · SSH · infra · todo · bookmark) dời lên hàng title, bù lại chiều cao tab bar chiếm — chrome tổng chỉ còn header + tab bar trước content.
- Chọn tab web trên strip = `selectTab` (khớp semantics panel); `×` = `closeTab` thật; `+` = tab trắng + autofocus ô URL.

## Liên kết

- [VISION](../../artifacts/VISION.md)
- [MVP scope](../requirements/mvp-scope.md)
- ADR: [0086 embedded browser panel](../decisions/0086-embedded-browser-panel.md), [0043 browser tool](../decisions/0043-browser-tool-embedded-chromium.md)
- Spec hiện hữu: [session-browser-panel](./session-browser-panel.md), [workspace-panel](./workspace-panel.md)
