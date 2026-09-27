# Feature Spec: Mobile Remote UI — iOS-leaning refactor

> **Status:** code landed (2026-09-27) — typecheck + build sạch; **chưa test tay trên máy thật**
> (iOS Safari / Android Chrome). Kiểm thử trình giả lập 390×844 đã qua: light + dark.
> **Phạm vi tài liệu:** **CHỈ lớp giao diện** của `apps/desktop/remote-pwa`. Protocol
> gateway/RPC, mô hình bảo mật và luồng pair giữ nguyên theo
> [mobile-remote-control.md](mobile-remote-control.md) — spec này KHÔNG đụng vào chúng.
> **Last updated:** 2026-09-27

---

## Problem

Remote PWA hoạt động đúng chức năng nhưng **trông như một trang web responsive**, không
phải một app mobile: header là toolbar kiểu desktop (nút icon có khung), danh sách là
card viền nổi, không có bottom tab bar, không có navigation stack — bấm nút back của
Android **thoát hẳn PWA** thay vì về danh sách. Cùng với đó là một lỗi thật: shell thiếu
`env(safe-area-inset-top)` nên với `viewport-fit=cover` header có thể nằm dưới notch của
iPhone.

Người dùng mở app này trên điện thoại, một tay, ngón cái — kỳ vọng tương tác giống app
native chứ không phải trang web thu nhỏ.

## Scope

### Trong phạm vi (đã implement)

| # | Hạng mục | Nơi | Ghi chú |
|---|----------|-----|---------|
| 1 | Safe-area top | `style.css` `#app` | `padding-top: env(safe-area-inset-top)` trên shell — một chỗ che cả nav bar, connection strip và mọi pushed layer |
| 2 | Navigation stack | `store.ts` | Stack `list/tasks` → push `session`; mỗi push ghi `history.pushState({k})`; `popstate` là authority duy nhất cho back — nút back của Android/browser pop về list thay vì thoát app; forward desktop restore được session vừa pop (`lastClosed`) |
| 3 | Push/pop transition + edge swipe-back | `App.vue` | `.under` recede -26% (parallax kiểu iOS) + `.over` trượt từ phải; vuốt từ mép trái ≤26px kéo theo finger, quá 35% width thì commit pop |
| 4 | Bottom tab bar | `components/TabBar.vue` | Sessions \| Tasks, badge `awaitingCount`, blur translucent, `--sab`; chỉ hiện ở tầng root, tự ẩn khi keyboard mở |
| 5 | NavBar iOS | `components/NavBar.vue` | Borderless accent buttons (`.navbtn` global), compact title + subtitle, `large` mode: compact title + hairline chỉ hiện khi scroll collapse (`useScrollCollapse`) |
| 6 | Pull-to-refresh | `gestures.ts` `usePullToRefresh` | Chỉ bắt khi `scrollTop === 0`, damping 0.45, threshold 64px, `overscroll-behavior-y: contain` chặn pull-to-reload của Chrome; bỏ nút Refresh thủ công |
| 7 | List rows full-bleed | `SessionListView.vue`, `TasksView.vue` | Bỏ card viền → hàng UITableView: full-width, hairline separator inset 16px, `:active` nhấn xám; skeleton shimmer thay spinner lần đầu load |
| 8 | Swipe-left action | `components/SwipeRow.vue` | Vuốt trái lộ action xoá đỏ; chạm lần 1 arm "Chắc?" (2.6s), lần 2 mới `sessions.delete`; deadzone 9px để scroll dọc không bị cướp gesture |
| 9 | Sheet drag-to-dismiss | `components/AppSheet.vue` | Grab handle là gesture thật: kéo translateY theo finger, thả > max(80px, 25% chiều cao) thì đóng, không thì snap về; scrim tap + nút X giữ nguyên |
| 10 | Composer gọn | `components/Composer.vue` | Gom attach+camera thành nút `+` mở action sheet; mode chip + config strip gộp một hàng context (mode mở sheet picker liệt kê hẳn 4 mode kèm cảnh báo ungated); tối đa 2 hàng trên keyboard |
| 11 | Segmented control + haptics + skeleton | `SessionView.vue`, `store.ts` | Chat/Diff/Cost thành iOS segmented control; `buzz()` cho tab/send/approve/PTR vượt threshold; skeleton rows khi list load lần đầu |

### Ngoài phạm vi (không đổi)

- Gateway/RPC contract, allowlist method, pairing, mô hình bảo mật — xem spec gốc.
- Business logic: outbox, resume/reconnect, reconcile interrupted turn, attachments.
- `max-width: 720px` của shell (tablet/desktop giữ nguyên).
- PairView (ngoài vụ nó hưởng luôn safe-area top).
- Web Push / P3.

## Quyết định thiết kế

- **Không dependency mới** — mọi gesture (edge swipe, pull-to-refresh, swipe row, sheet
  drag) là touch handler viết tay trong `gestures.ts` / component. App này chạy trên
  tailnet của chính user, bundle nhẹ và không lệ thuộc lifecycle lib là ưu tiên.
- **`popstate` là authority duy nhất cho back** — `navPop()` gọi `history.back()` khi
  entry hiện tại là của mình, để history browser và stack in-app không bao giờ lệch.
  Mỗi stack entry mang khoá `k`; popstate so khoá để biết pop hay forward.
- **Session push che TabBar** (không phải ẩn) — giống iOS: layer `.over` trượt lên trên,
  nên back là một slide-out thật chứ không phải re-layout.
- **Swipe-delete là 2-tap** — iOS confirm bằng dialog, nhưng trên remote session xoá là
  destructive và mạng có thể lag: arm "Chắc?" ngay trên nút đỏ rẻ và nhanh hơn.
- **Composer giữ tối đa 2 hàng** trên keyboard: hàng context (mode chip + config) + hàng
  input. Queued banner và BackgroundChips chỉ hiện khi có dữ liệu.
- **`--sat` trên shell, không phải từng view** — `padding-top` của `#app` che notch cho
  mọi màn hình kể cả sheet và pushed layer; `--kb` chỉ cắt đáy.

## Edge cases đã xử lý

- **Popstate forward:** session vừa pop được restore qua `lastClosed` (adopt khoá cũ,
  không ghi history mới).
- **Mở session từ search khi đang ở session:** không push thêm — giữ cùng stack layer,
  tránh entry chết.
- **PTR vs scroll:** finger quay lên hoặc scroller rời đỉnh → gesture huỷ, trả lại cho
  scroller. `touchmove` non-passive chỉ preventDefault khi pull đã chắc chắn engage.
- **Swipe row vs scroll dọc:** deadzone 9px + so sánh |dy|>|dx| — scroll dọc thắng.
- **Edge swipe vs tap mép trái:** touchstart tắt inline transition ngay nhưng tap thuần
  (không engage) phải khôi phục — nếu không leave transition bị nuốt.
- **Keyboard mở:** `--kb` cắt `.app` + scrim sheet `bottom: var(--kb)`; TabBar `v-show`
  ẩn hẳn; composer bám mép trên keyboard.
- **`prefers-reduced-motion`:** slide transition ~0ms, shimmer skeleton dừng, spinner
  quay chậm (2.4s) vì nó là tín hiệu "request đang chạy" duy nhất.

## Validation

- `pnpm typecheck` ✅ · `pnpm build` ✅ (chỉ còn warning chunk >500kB có sẵn)
- Emulator 390×844: light ✅ · dark ✅ · tab switch ✅ · large title + badge ✅
- **Chưa verify trên máy thật** (cần gateway chạy): edge-swipe theo finger, PTR trên
  list có data, swipe-delete 2-tap, sheet drag khi keyboard mở, back của Android.

## Demo mode (không cần desktop)

`pnpm dev` rồi mở `http://localhost:<port>/?demo`: `src/demo.ts` thay socket bằng
data + scripted events — 5 session đủ trạng thái (running/awaiting/error/done),
transcript có tool steps + todo + plan card + question card, permission gate bật
lên khi mở session s1, gửi tin nhắn sẽ stream reply từng chunk, tasks có
approve/pause/cancel/create, diff + cost có data. Chỉ chạy khi
`import.meta.env.DEV && ?demo`; production build tree-shake hết, không vào bundle.

## File liên quan

- `apps/desktop/remote-pwa/src/store.ts` — nav stack, popstate
- `apps/desktop/remote-pwa/src/gestures.ts` — `usePullToRefresh`, `useScrollCollapse`
- `apps/desktop/remote-pwa/src/App.vue` — stage under/over, edge swipe-back
- `apps/desktop/remote-pwa/src/components/NavBar.vue` · `TabBar.vue` · `SwipeRow.vue`
- `apps/desktop/remote-pwa/src/components/AppSheet.vue` · `Composer.vue`
- `apps/desktop/remote-pwa/src/views/SessionListView.vue` · `SessionView.vue` · `TasksView.vue`
- `apps/desktop/remote-pwa/src/style.css` — `--sat` (qua `#app`), `.navbtn`, `.big`,
  `.ptr`, `.skel`
