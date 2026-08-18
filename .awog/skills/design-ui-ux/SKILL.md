---
name: design-ui-ux
description: "UI/UX design intelligence for the AWOG desktop app (Vue 3 + Tailwind 3 + lucide + useTheme() token system, Electron). Use when designing or refactoring pages, panels, components (button, modal, sidebar, card, table, form, chart, navrail, composer), choosing visual style, color, typography, spacing, layout, animation, interaction states, dark/light theme — or reviewing UI for accessibility, consistency, and perceived quality. Actions: plan, build, create, design, implement, review, fix, improve, polish UI. Provides priority-ranked rules (a11y, keyboard, performance, style, layout, typography/color, animation, forms, navigation, charts), AWOG-native conventions (theme tokens, no hardcoded hex, AppSelect, font-size scale), a design-decision workflow, and a pre-delivery checklist. Adapted from ui-ux-pro-max for AWOG conventions (markdown-only, no Python)."
---

# Skill: Design UI/UX (AWOG desktop)

Design intelligence cho UI của AWOG — chọn style/màu/typography, dựng component, và tự review chất lượng. Adapt từ [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), tái định hướng sang **desktop-web (Electron/Chromium) + Vue 3 + Tailwind + `useTheme()`**, bỏ phần mobile/React Native và bỏ Python/CSV.

## Khi nào dùng

**Bắt buộc dùng** khi task chạm tới *bố cục, quyết định thị giác, pattern tương tác, hoặc chất lượng trải nghiệm*:

- Dựng trang / panel / màn mới (Sessions, Git, Tasks, Workflow, Settings…).
- Tạo hoặc refactor component UI (button, modal, sidebar, card, table, form, chart, composer, NavRail).
- Chọn style thị giác, bảng màu, hệ typography, scale spacing, hệ layout.
- Review code UI về accessibility, nhất quán thị giác, hoặc "trông chưa đủ pro".
- Làm navigation, animation, interaction state, hoặc dark/light theme.

**Khuyến nghị** khi: UI "trông chưa pro" mà chưa rõ lý do; nhận feedback về usability; tối ưu chất lượng trước release; dựng design system / component tái dùng.

**Bỏ qua** khi: logic sidecar thuần, IPC/parse, file storage, build/release — không đụng tới cái người dùng *nhìn / cảm / tương tác*.

> **Tiêu chí quyết định:** nếu task đổi cách một tính năng **trông, cảm, chuyển động, hoặc được tương tác** → dùng skill này.

## Ngữ cảnh AWOG (đọc trước khi quyết định)

Mọi rule bên dưới phải tôn trọng convention sẵn có của AWOG. Đừng phát minh hệ thiết kế mới:

| Khía cạnh | AWOG đã có | Quy tắc |
|---|---|---|
| **Màu** | [`useTheme()`](../../../apps/desktop/ui-next/composables/useTheme.ts) — theme token CSS-var (`bg`, `text`, `textDim`, `border`, `bgHover`, `accent`, `danger`, `dangerBg`…) | **Không hardcode hex.** Màu theme đi qua inline `:style`, không class Tailwind màu. Light + dark luôn test cùng nhau. |
| **Layout/spacing** | Tailwind 3 utility | Class Tailwind cho layout/spacing/typography; scale spacing nhất quán (4/8px rhythm). |
| **Font-size** | [`useAppearanceDom`](../../../apps/desktop/ui-next/composables/useAppearanceDom.ts) `--font-size-base` (12→18px) | Body text dùng `text-[1em]` (scale theo setting). Badge/hint/count chip = `text-[12px]` fixed + `font-mono leading-none`. Không `text-xs`/`text-sm` cho text đọc được. |
| **Icon** | `lucide-vue-next` | **Không emoji làm icon.** Một bộ icon, stroke đồng nhất, size theo token. Detail header → icon-only `13px` + `title` attr. |
| **Dropdown** | `AppSelect` | **Không `<select>` native** (WKWebView bỏ qua padding). Dùng `AppSelect` slot-based, cùng height `AppInput`. |
| **Component lớn** | composable page-controller | SFC > ~250 dòng → đẩy state/logic vào `useXxxManager()`, template mỏng. Markup lặp → component con. |
| **Reactivity nặng** | `shallowRef`/`computed` | Object lớn (Monaco, VueFlow, graph) dùng `shallowRef`. Tránh `watch` deep; ưu tiên `computed`. |

Chi tiết: [.claude/rules/nuxt-vue.md](../../rules/nuxt-vue.md) (UI patterns), [docs/coding/nuxt-frontend.md](../../../docs/coding/nuxt-frontend.md).

## Workflow

### Bước 1 — Phân tích yêu cầu

Rút ra:
- **Loại bề mặt:** trang full / panel docked / modal / inline component / data-viz.
- **Mật độ & ngữ cảnh:** thao tác nhiều (Git, Workflow editor) cần dày & nhanh; nội dung dài (Session transcript) cần thoáng & dễ đọc.
- **Tông:** AWOG là tool dev local-first → ưu tiên **minimal, content-first, dày thông tin, dark-mode-first**. Tránh playful/skeuomorphic.
- **Trạng thái:** liệt kê đủ loading / empty / error / disabled / selected trước khi code.

### Bước 2 — Quyết định design system (nhẹ, dùng catalog bên dưới)

1. Chọn **style** từ [§ Catalog style](#catalog-chọn-nhanh) hợp loại sản phẩm (AWOG → minimalism / flat, glass tiết chế cho overlay).
2. Chọn **màu** → map vào token `useTheme()` sẵn có; nếu thiếu token, thêm token CSS-var qua [`useTheme()`](../../../apps/desktop/ui-next/composables/useTheme.ts) (đừng hardcode tại component).
3. Chọn **typography**: 1 cặp heading/body, type scale nhất quán (12 14 16 18 24 32), weight phân cấp (600–700 heading, 400 body, 500 label).
4. Định **effect** khớp style: shadow scale nhất quán, radius nhất quán, blur chỉ cho overlay (không trang trí).
5. Liệt kê **anti-pattern** cần né cho bề mặt này (xem từng nhóm rule).

### Bước 3 — Implement

- Theo layer AWOG (xem skill `implement-feature`): `utils/` → `composables/` → `stores/` → `components/` → `pages/`.
- Áp token `useTheme()`, `text-[1em]`, `AppSelect`, lucide icon ngay từ đầu — đừng hardcode rồi sửa sau.
- Mỗi trạng thái (loading/empty/error/disabled) phải có UI thật, không để trống.

### Bước 4 — Tự review

Chạy qua [§ Pre-delivery checklist](#pre-delivery-checklist). Ưu tiên nhóm **CRITICAL → HIGH** trước. Test **dark + light** và resize cửa sổ.

## Rule theo priority

Đi từ priority 1 → 10. Mỗi nhóm: *Must have* + *Anti-pattern*.

### 1. Accessibility — CRITICAL
- **Contrast** ≥ 4.5:1 cho text thường (3:1 cho text lớn / glyph UI). Test riêng dark mode, đừng suy từ light.
- **Focus state** rõ trên mọi element tương tác (ring 2px qua token `accent`). ❌ Không bao giờ `outline: none` mà không thay focus ring khác.
- **Keyboard nav** đầy đủ: tab order khớp thứ tự thị giác, Esc đóng modal, Enter submit. AWOG là desktop → keyboard là first-class.
- **Aria-label** cho button icon-only (mọi nút lucide không có text). `label`/`for` cho input.
- **Màu không phải kênh duy nhất**: trạng thái (error/success) kèm icon hoặc chữ, không chỉ đỏ/xanh.
- **`prefers-reduced-motion`**: giảm/tắt animation khi user yêu cầu.
- ❌ Anti: gỡ focus ring, nút icon không label, heading nhảy cấp (h1→h3), contrast xám-trên-xám.

### 2. Interaction & con trỏ — CRITICAL
- **`cursor-pointer`** cho mọi element click được. Hit area đủ rộng cho icon nhỏ (đệm padding, không bắt click pixel-perfect).
- **Feedback tức thì** (<100ms) khi hover/press: đổi `bgHover`/opacity/elevation, không dịch layout.
- **Loading khi async**: disable button + spinner; không để user bấm lại.
- **Error gần chỗ lỗi**, message nói *nguyên nhân + cách sửa*, không chỉ "Invalid".
- ❌ Anti: chỉ dựa vào `:hover` cho hành động chính, đổi trạng thái 0ms (snap), control trông bấm được nhưng không làm gì.

### 3. Performance — HIGH
- **`shallowRef`/`shallowReactive`** cho object lớn (Monaco, VueFlow, transcript). **`computed`** thay `watch` deep.
- **Virtual scroll** cho list > ~200 item (Git đã làm ở > 200 file/section). Lazy-load route nặng / dynamic import.
- **Reserve space** cho nội dung async (skeleton/placeholder) → tránh layout shift (CLS).
- **Debounce/throttle** event tần suất cao (scroll, resize, input, watcher).
- ❌ Anti: `watch` deep object lớn, render 1000+ row không virtual, layout nhảy khi load.

### 4. Chọn style — HIGH
- **Khớp loại sản phẩm**: AWOG = dev tool → minimalism/flat; glass chỉ cho overlay (modal scrim, popover) chứ không trang trí.
- **Nhất quán toàn app**: một ngôn ngữ style cho mọi trang. Một bộ icon (lucide), một stroke width.
- **Effect khớp style**: shadow/blur/radius theo một scale; đừng random giá trị shadow.
- **Dark/light thiết kế song song**: giữ brand + contrast nhất quán cả 2 mode (qua token).
- **Một primary CTA / màn**: action phụ subordinate thị giác.
- ❌ Anti: trộn flat + skeuomorphic, emoji làm icon, shadow tùy tiện, nhiều CTA ngang hàng.

### 5. Layout & responsive (desktop) — HIGH
- **Resizable/collapsible** cho panel/sidebar (Git đã làm), nhớ trạng thái (persist).
- **Max-width nội dung đọc**: text dài giữ 60–75 ký tự/dòng, không kéo full-width trên màn rộng.
- **Z-index có hệ**: thang rõ (vd 0/10/20/40/100/1000), không số ma thuật rải rác.
- **Fixed element chừa chỗ**: navbar/footer cố định reserve padding cho nội dung dưới.
- **Spacing rhythm 4/8px**, gutter nhất quán; phân cấp section bằng vertical rhythm tier (16/24/32/48).
- ❌ Anti: horizontal scroll ngoài ý muốn, width container tùy tiện mỗi trang, nested scroll xung đột scroll chính.

### 6. Typography & màu — MEDIUM
- **Body** `line-height` 1.5–1.75; type scale nhất quán; weight phân cấp.
- **Token màu ngữ nghĩa** (`accent`/`danger`/`textDim`/`bgHover`…) — **không hex thô trong component** (dùng `useTheme()`).
- **Dark mode** = tông desaturate/sáng hơn, **không** invert thô; test contrast riêng.
- **Tabular figures** (`font-mono` / `tabular-nums`) cho số liệu cột, badge số, giá, timer → tránh nhảy layout.
- **Truncate có lối thoát**: ưu tiên wrap; khi truncate phải có tooltip/expand xem full.
- ❌ Anti: text < 12px cho nội dung đọc, hex hardcode, dark mode invert, badge số nhảy width.

### 7. Animation — MEDIUM
- **Duration** 150–300ms cho micro-interaction; ≤400ms cho transition phức tạp; tránh >500ms.
- **Chỉ `transform`/`opacity`** — không animate `width`/`height`/`top`/`left` (gây reflow).
- **Có ý nghĩa**: mỗi animation diễn đạt nhân-quả, không trang trí. Tối đa 1–2 element động/màn.
- **Easing**: ease-out khi vào, ease-in khi ra; exit nhanh hơn enter (~60–70%).
- **Interruptible**: thao tác user hủy được animation đang chạy; không block input.
- ❌ Anti: animate width/height, animation trang trí thuần, linear cho UI, bỏ qua reduced-motion.

### 8. Form & feedback — MEDIUM
- **Label hiện rõ** mỗi input (không chỉ placeholder). Đánh dấu field bắt buộc.
- **Error dưới field** liên quan; với nhiều lỗi → summary đầu + anchor; auto-focus field lỗi đầu tiên.
- **Validate on blur** (không mỗi keystroke). Submit → loading → success/error.
- **Disabled state**: opacity giảm (0.38–0.5) + cursor đổi + thuộc tính semantic.
- **Empty state** hữu ích: message + action, không để trống.
- **Confirm trước hành động phá hủy**; cho undo nếu được; toast tự tắt 3–5s, không cướp focus (`aria-live`).
- ❌ Anti: placeholder thay label, lỗi chỉ hiện ở đầu trang, validate từng phím, destructive không xác nhận.

### 9. Navigation — HIGH
- **Vị trí nav nhất quán** mọi trang; current location highlight rõ (màu/weight/indicator).
- **Phân cấp rõ**: nav chính (NavRail) vs phụ (sidebar/settings) tách biệt; ≥1024px ưu tiên sidebar.
- **Back/state preserve**: quay lại khôi phục scroll + filter + input.
- **Modal có lối đóng rõ** (Esc + nút close); modal không dùng cho luồng điều hướng chính.
- **Breadcrumb** cho cây ≥ 3 cấp; search dễ với tới + gợi ý recent.
- ❌ Anti: trộn nhiều pattern nav cùng cấp, reset nav stack ngầm, nav đổi vị trí theo trang, destructive lẫn nav thường.

### 10. Charts & data — LOW
- **Khớp loại chart với dữ liệu**: trend→line, so sánh→bar, tỷ lệ→pie/donut (≤5 mục, >5 dùng bar).
- **Màu accessible**: tránh chỉ đỏ/xanh; bổ sung pattern/shape; data line vs nền ≥3:1.
- **Legend hiện + tooltip** giá trị chính xác; axis có đơn vị; số format theo locale.
- **Empty / loading / error state** cho chart: "Chưa có dữ liệu" + hướng dẫn / skeleton / retry — không khung trục trống hay chart vỡ.
- **Bảng thay thế** cho screen reader; tooltip reach được bằng keyboard.
- ❌ Anti: pie cho nhiều mục, chỉ dùng màu truyền nghĩa, axis chen chúc, chart rỗng khi lỗi.

## Catalog chọn nhanh

> Bản rút gọn để quyết định nhanh. AWOG là dev tool desktop → mặc định cột **Khuyến nghị AWOG**.

### Style

| Style | Đặc trưng | Hợp với | Khuyến nghị AWOG |
|---|---|---|---|
| **Minimalism / Flat** | phẳng, nhiều whitespace, viền mảnh | tool, dashboard, dev app | ✅ mặc định |
| **Glassmorphism** | blur nền, trong mờ, viền sáng | overlay, modal, command palette | ⚠️ chỉ cho overlay |
| **Bento grid** | ô module kích thước khác nhau | dashboard, trang tổng quan | ✅ cho Home/overview |
| **Neumorphism / Claymorphism** | bóng mềm lồi/lõm | app vui, consumer | ❌ tránh (contrast kém) |
| **Brutalism** | tương phản mạnh, viền đậm | portfolio, landing | ❌ tránh trong app |
| **Dark mode first** | nền tối, accent bão hòa nhẹ | dev tool | ✅ AWOG là dark-first |

### Màu (map vào token, không hardcode)

| Ngữ cảnh | Hướng palette | Token AWOG |
|---|---|---|
| Nền / surface | trung tính, phân tầng nhẹ (card hơi sáng/tối hơn bg) | `bg`, `bgHover`, `border` |
| Text | chính ≥4.5:1, phụ ≥3:1 | `text`, `textDim` |
| Accent / primary | một accent, dùng cho CTA + focus + active | `accent` |
| Destructive | đỏ semantic, tách biệt thị giác | `danger`, `dangerBg` |
| Trạng thái | success/warn/info — luôn kèm icon | thêm token nếu thiếu |

### Typography

| Vai trò | Gợi ý | Quy tắc AWOG |
|---|---|---|
| Body | sans đọc tốt, 1 font | `text-[1em]`, line-height 1.5–1.75 |
| Heading | cùng họ hoặc cặp tương phản nhẹ | weight 600–700, type scale rời rạc |
| Label / hint | medium 500 | `text-[12px]` fixed cho badge/chip |
| Số liệu | tabular | `font-mono` / `tabular-nums` |

## Pre-delivery checklist

Verify trước khi báo done (ưu tiên CRITICAL → HIGH):

**Accessibility**
- [ ] Contrast text ≥4.5:1 ở **cả** dark + light.
- [ ] Focus ring rõ mọi element tương tác; tab order khớp thị giác; Esc đóng modal.
- [ ] Button icon-only có `aria-label`/`title`; input có label.
- [ ] Màu không phải kênh truyền nghĩa duy nhất; reduced-motion được tôn trọng.

**Thị giác & nhất quán**
- [ ] Không hardcode hex — màu qua `useTheme()`.
- [ ] Một bộ icon lucide, stroke đồng nhất, không emoji làm icon.
- [ ] Shadow/radius/spacing theo scale nhất quán; press không dịch layout.
- [ ] Body `text-[1em]`, badge/chip `text-[12px]` + tabular cho số.

**Interaction & state**
- [ ] `cursor-pointer` cho mọi element click; hit area đủ.
- [ ] Có UI cho **loading / empty / error / disabled / selected**.
- [ ] Async → disable + spinner; error nói cách sửa.
- [ ] `AppSelect` thay `<select>` native.

**Layout & perf**
- [ ] Test dark + light + resize cửa sổ; không horizontal scroll ngoài ý.
- [ ] List lớn virtual; object lớn `shallowRef`; `computed` thay `watch` deep.
- [ ] SFC > ~250 dòng → tách composable + component con.

## Anti-pattern khiến UI thiếu chuyên nghiệp

- ❌ Emoji làm structural icon (font-dependent, lệch nền tảng) → dùng lucide SVG.
- ❌ Hardcode hex trong component → token `useTheme()`.
- ❌ `<select>` native trong WKWebView (mất padding) → `AppSelect`.
- ❌ `text-xs`/`text-sm` cho text đọc được → `text-[1em]` để user chỉnh qua Appearance.
- ❌ Bỏ focus ring cho "đẹp" → giết keyboard a11y.
- ❌ Press state làm dịch layout (jitter) → đổi màu/opacity, giữ bounds.
- ❌ Chỉ thiết kế light mode rồi suy ra dark → test riêng từng mode.
- ❌ Thiếu empty/error/loading state → màn trống khó hiểu.
- ❌ Nhiều primary CTA ngang hàng → loãng phân cấp.

## Liên kết với role/skill khác

- **Khi implement:** đi cùng skill `implement-feature` (developer) — skill này lo *thiết kế*, kia lo *quy trình code*.
- **Khi review:** bổ trợ skill `review-pr` (nhóm UI/UX) — dùng checklist ở đây làm tiêu chí.
- **Khi đụng a11y/security surface:** handoff `infosec` nếu có `v-html` từ input user.
- **Nguồn gốc:** adapt từ [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT) — bỏ Python/CSV + mobile, tái định hướng desktop-web Vue/Tailwind.
