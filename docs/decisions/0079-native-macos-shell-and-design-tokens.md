# 0079 — Vỏ cửa sổ native + thang design token cho ui-next

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-06
- **Người quyết định:** Tech Lead (theo yêu cầu user: "app đọc như web page nhét trong cửa sổ")

## Bối cảnh

`ui-next` được dựng bằng cách **port verbatim** CSS của prototype web (xem comment đầu [app-shell.css](../../apps/desktop/ui-next/assets/css/app-shell.css): prototype render `.app` như một "showcase card" giữa trang). Hệ quả là một app Electron mang idiom của trang web: title bar macOS mặc định đè lên app tối, không kéo được cửa sổ từ top bar, và mọi giá trị hình học được viết tay tại chỗ.

Scan ngày 2026-09-06 trên `main` @ v0.33.0 (chi tiết ở [native-macos-polish.md §2](../features/native-macos-polish.md)):

| Hạng mục | Số liệu |
|---|---:|
| `border-radius` bằng px | **702 site / 18 giá trị** khác nhau |
| `font-size` bằng rem | **727 site / 15 giá trị**, nhiều giá trị ra **nửa pixel** |
| Token `--r-*` thực sự được dùng | 50 / 702 (7%) |
| Token `--dur-fast` được dùng | **0** |
| `var(--code)` trên chữ **UI** (không phải code) | 267 site / 114 file |
| `-webkit-app-region` | **0** |
| `titleBarStyle` / `vibrancy` | **0** |

Hai ràng buộc định hình mọi quyết định dưới đây:

1. **Appearance cho user kéo `--font-size-base` từ 12 → 18px** ([useAppearanceDom.ts](../../apps/desktop/ui-next/composables/useAppearanceDom.ts)). Mọi thang chữ phải cho ra **pixel nguyên ở cả 7 mức base**, không chỉ ở mức mặc định 13px.
2. **Không thêm dependency** ([CLAUDE.md](../../CLAUDE.md), [principles.md](../../.claude/rules/principles.md)) — kể cả công cụ codemod hay linter CSS.

Scale token cần dùng **đã tồn tại** nhưng ngủ yên: `--r-xs|sm|btn|card|panel|pill` và `--dur-fast|dur|dur-panel` được [ADR 0072 D-7](./0072-cute-theme-family.md) thêm vào `prototype.css :root` như phần cộng thêm vô hại, kèm comment tự thú *"no existing rule reads them"*. ADR này chính là lúc đọc chúng.

## Quyết định

| # | Mảnh | Quyết định |
|---|---|---|
| **D1** | Cách token hoá | Dùng **codemod** (`scripts/codemod-radius.mjs`, `scripts/codemod-type-scale.mjs` — Node thuần) + **guard script** ([scripts/check-design-tokens.mjs](../../apps/desktop/ui-next/scripts/check-design-tokens.mjs)), **không** sửa tay. |
| **D2** | Thang chữ | `--fs-*` khai bằng `calc(var(--font-size-base) ± Npx)`, **cấm rem**. |
| **D3** | Mono | `var(--code)` chỉ dành cho code thật; chỗ dùng mono để *căn số* chuyển sang `--sans` + `font-variant-numeric: tabular-nums`. |
| **D4** | Vỏ cửa sổ | Title bar do OS vẽ được **giấu** ở cửa sổ chính, top bar của app trở thành drag region; popout session **giữ frame native**. |
| **D5** | Vibrancy | **Ngoài phạm vi** ADR này — tách ADR riêng. |

### D1 — Token hoá bằng codemod + guard, không sửa tay

702 + 727 site là **cơ học nhưng quá đông**: sửa tay chắc chắn sót, và cái sót không nhìn thấy được (một chỗ `7px` lẫn giữa các chỗ `var(--r-xs)` trông y hệt nhau trên màn hình). Hai script codemod đọc bảng map cố định dưới đây rồi rewrite tại chỗ; diff to nhưng **đọc được từng dòng** vì mỗi thay đổi là một phép thế thuần cú pháp.

Radius — 18 giá trị ép về 6 token đã khai sẵn:

| px hiện tại | → token | px mới |
|---|---|---:|
| 1 2 3 4 5 6 7 | `--r-xs` | 6 |
| 8 9 | `--r-sm` | 8 |
| 10 11 12 | `--r-btn` | 10 |
| 13 14 | `--r-card` | 14 |
| 16 | `--r-panel` | 16 |
| 99 999 9999 | `--r-pill` | 999 |

Codemod **phải chạy cả trên** [theme-cute.css](../../apps/desktop/ui-next/assets/css/theme-cute.css) (49 site) — bỏ sót là hai theme family lệch bo góc nhau.

Guard script chống tái phát: fail khi thấy `border-radius: <n>px`, `font-size: <n>rem`, hoặc `var(--code)` ở file ngoài allowlist; in `file:line` + đoạn vi phạm + token gợi ý. **Ngoại lệ khai tường minh trong chính script** (xem D-Ngoại-lệ) để guard không báo giả. Guard chỉ được nối vào `pnpm lint` **sau khi** hai codemod và đợt triage mono đã landed — nối sớm là lint đỏ toàn tập, và một lint đỏ mặc định thì không ai đọc nữa.

### D2 — Thang chữ dùng `calc(base ± Npx)`, không dùng rem

```
--fs-xs:  calc(var(--font-size-base) - 2px);   /* 11 @base13 */
--fs-sm:  calc(var(--font-size-base) - 1px);   /* 12 */
--fs-md:  var(--font-size-base);               /* 13 — body */
--fs-lg:  calc(var(--font-size-base) + 2px);   /* 15 */
--fs-xl:  calc(var(--font-size-base) + 4px);   /* 17 */
--fs-2xl: calc(var(--font-size-base) + 9px);   /* 22 */
```

Lý do **không** dùng rem: rem là *tỉ lệ* với base, nên khi base kéo được thì mọi bậc đều rơi vào phân số. Bảng hiện trạng cho thấy điều đó đã xảy ra ngay ở base mặc định 13px:

| rem hiện tại | px @base13 |
|---|---:|
| `0.8846rem` | **11.5** |
| `0.9615rem` | **12.5** |
| `1.0385rem` | **13.5** |

Chữ ở nửa pixel bị macOS render nhoè (WKWebView/Chromium không snap glyph theo pixel ở cỡ phân số) — đây chính là một phần của cảm giác "không native". `calc(base ± Npx)` giữ **hiệu số nguyên**: base nguyên ⇒ mọi bậc nguyên, ở cả 7 mức 12→18. Đổi lại thang không còn *tỉ lệ* mà là *offset* — ở base 18 thì `--fs-xs` là 16 (chênh 2) chứ không phải 15.2 (chênh 15%). Chấp nhận: thang chữ UI của app desktop hẹp (11→22px), khoảng chênh tuyệt đối là đúng ý đồ, và độ nét thắng độ "đúng tỉ lệ".

Bảng map cho codemod (727 site → 6 token):

| rem hiện tại | = px @13 | → token |
|---|---:|---|
| `0.6923` `0.7692` `0.8077` `0.8462` | 9 / 10 / 10.5 / 11 | `--fs-xs` |
| `0.8846` `0.9231` `0.9615` | 11.5 / 12 / 12.5 | `--fs-sm` |
| `1` `1.0385` | 13 / 13.5 | `--fs-md` |
| `1.0769` `1.1154` `1.1538` | 14 / 14.5 / 15 | `--fs-lg` |
| `1.3846` | 18 | `--fs-xl` |
| `1.6923` | 22 | `--fs-2xl` |

### D3 — Mono chỉ cho code thật

267 site đặt `font-family: var(--code)` lên chữ **UI**: timestamp, count, badge, chip, tag, section header, subtitle, avatar initial, phím tắt. Đọc kỹ thì lý do gần như luôn là **căn số cho thẳng cột**, không phải "đây là code". Mono trả cho việc đó bằng cả một diện mạo terminal áp lên toàn app — sai idiom cho một app macOS, nơi mono là tín hiệu *"đây là máy nói"*.

`font-variant-numeric: tabular-nums` trên `--sans` cho **đúng** thứ cần (chữ số cùng bề rộng ⇒ số thẳng cột, không nhảy khi đổi giá trị) mà không mang theo diện mạo terminal. Thêm một class dùng chung `.tnum` vào `prototype.css`.

Giữ mono ở: code block, diff viewer, terminal, log tail, đường dẫn file, SHA, JSON viewer. Đây là workstream **duy nhất cần mắt người** — phân loại theo *ngữ nghĩa*, không theo cú pháp, nên **không** có codemod; quy trình là sinh inventory bằng script rồi duyệt theo file. Allowlist trong guard script bắt đầu bằng phần lõi hiển nhiên và được chốt lại ở cuối đợt triage.

### D4 — Vỏ cửa sổ native

| Cửa sổ | Xử lý |
|---|---|
| Chính ([window.ts](../../apps/desktop/electron/src/window.ts)) | macOS: `titleBarStyle: 'hiddenInset'` + `trafficLightPosition {x:14,y:15}`. Windows/Linux: `titleBarStyle: 'hidden'` + `titleBarOverlay` màu theo app. Mọi nền tảng: `backgroundColor` để không nháy trắng trước frame đầu. |
| Popout session ([session-window.ts](../../apps/desktop/electron/src/session-window.ts)) | **Giữ frame native.** Popout là *document window*; macOS vẽ title bar thật cho document window, và đó cũng là nơi user mong đợi thấy tên session. Chỉ mượn `backgroundColor` để hết nháy trắng. |
| Tray popover ([popover.ts](../../apps/desktop/electron/src/popover.ts)) | Đã frameless từ trước — không thuộc phạm vi đợt này ngoài việc bo góc. |
| [browser.ts](../../apps/desktop/electron/src/browser.ts), [pet-window.ts](../../apps/desktop/electron/src/pet-window.ts) | **Không đụng.** |

Top bar của app (`.top`) nhận `-webkit-app-region: drag`; **mọi** con tương tác bên trong phải `no-drag` — bỏ sót một nút là nút đó không bấm được nữa, không phải lỗi thị giác mà là lỗi chức năng.

Chỗ ở phải xử lý **tường minh hai nhánh**, không suy ra được từ nhau:

- **Fullscreen** — macOS ẩn đèn giao thông, nên inset dành cho chúng phải rút về 0. Main process phát `window:fullscreen` (`enter-full-screen` / `leave-full-screen`, **và** phát lại sau mỗi `did-finish-load` vì reload dựng lại attribute trên `<body>` từ đầu); renderer set `body[data-fullscreen]`.
- **Compact mode (≤1100px)** — NavRail thu thành drawer nên `.side` không còn chiếm cột trái, đèn giao thông rơi thẳng lên `.top`. Ở nhánh này inset chuyển từ `padding-top` của `.side` sang `padding-left` của `.top`.

### D5 — Vibrancy / translucency ngoài phạm vi

`vibrancy: 'sidebar'` chỉ có tác dụng khi bề mặt phía trên nó **trong suốt**. Làm `.side` trong suốt nghĩa là mọi màu chữ và mọi đường viền trên đó không còn tương phản với một nền biết trước, mà với ảnh nền desktop của user — buộc phải retune **toàn bộ** thang tương phản, nhân ba: dark × light × theme family `cute` ([ADR 0072](./0072-cute-theme-family.md)). Đó là một quyết định riêng với rủi ro riêng, không phải một dòng option trong `BrowserWindow`. Gộp vào đây sẽ làm đợt này không review được: người review không phân biệt nổi "chữ mờ vì vibrancy" với "chữ mờ vì token mới".

⇒ Vibrancy là **P5, tuỳ chọn, ADR riêng**. ADR này cố ý không đặt nền móng gì cho nó ngoài việc không cản đường.

### Ngoại lệ cố ý — khai trong guard script

Guard **phải im lặng** ở 4 chỗ sau, nếu không nó sẽ bị tắt đi vì báo giả:

- `border-radius: 50%` (63 site) — vòng tròn (avatar, dot, spinner). Không token nào biểu diễn được.
- `font-size: <n>px` (221 site, hầu hết `12px`) — badge / hint / count chip **cố ý không scale** theo Appearance, theo [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md).
- `font-size` đơn vị **`em`** (~150 site) — tương đối với cha. Map sang token tuyệt đối là **đổi ngữ nghĩa**, không phải token hoá.
- `font-size: 2.4615rem` (32px) — hero / empty state, một site duy nhất.

Ngoài ra Monaco, xterm và VueFlow tự vẽ theo hệ của chúng, không theo token của app; [apps/desktop/remote-pwa/](../../apps/desktop/remote-pwa/) có CSS riêng và nằm ngoài phạm vi.

## Phương án đã cân nhắc

- **Sửa tay 702 + 727 site theo từng khu vực (Boy Scout).** *Từ chối:* nhịp sửa (vài chục site/tuần) chậm hơn nhịp thêm site mới; không có mốc "xong" nên guard không bao giờ bật được, và không bật guard thì đâu lại vào đấy.
- **Thêm Stylelint + plugin để guard.** *Từ chối:* thêm dependency cho một luật 3 dòng regex; script Node thuần đọc được, sửa được, và **khai ngoại lệ ngay cạnh luật** (Stylelint sẽ đẩy allowlist sang một file config thứ ba, xa chỗ nó nói về).
- **Giữ rem, chỉ chuẩn hoá về ít giá trị hơn.** *Từ chối:* không giải được nguyên nhân (rem × base kéo được = nửa pixel); chỉ giảm số lượng chỗ nhoè chứ không hết nhoè.
- **Bỏ hẳn `--code`, dùng sans ở mọi nơi.** *Từ chối:* diff, terminal và code block **cần** bề rộng cố định để cột thẳng hàng; đó là mono dùng đúng việc.
- **`frame: false` hoàn toàn, app tự vẽ cả nút đóng/thu nhỏ.** *Từ chối:* phải tự tái tạo hành vi hover-nhóm, fullscreen, và Stage Manager của macOS; `hiddenInset` cho đèn giao thông **thật** miễn phí.
- **Popout session cũng frameless.** *Từ chối:* xem D4 — document window trên macOS có title bar thật; bỏ đi thì user mất chỗ đọc tên session và mất double-click-to-zoom.

## Hệ quả

- **Tích cực:**
  - Bo góc và cỡ chữ có **một nguồn duy nhất**; đổi thang = sửa 6 dòng `:root` thay vì 1400 site.
  - Chữ nguyên pixel ở **mọi** mức Appearance 12→18 ⇒ hết nhoè trên macOS.
  - Guard script chặn tái phát ở PR sau, thay vì phát hiện bằng mắt sáu tháng sau.
  - Kéo được cửa sổ từ top bar, đèn giao thông ở đúng chỗ ⇒ app hành xử như app.
  - Không thêm dependency nào; `--r-*` / `--dur-*` của [ADR 0072](./0072-cute-theme-family.md) từ chỗ chết chuyển thành nguồn thật.
- **Tiêu cực / Trade-off:**
  - Diff của phase codemod rất to (~220 file). Giảm nhẹ bằng cách tách **hai commit riêng** (radius / type) và giữ mỗi thay đổi là phép thế thuần cú pháp.
  - Ép 18 giá trị radius về 6 làm **lệch bo góc lồng nhau** ở vài chỗ (quy tắc `inner = outer − padding` không còn đúng sau khi 12→10). Phải duyệt tay các card lồng.
  - Thang chữ là offset chứ không phải tỉ lệ (xem D2) — ở base 18 các bậc gần nhau hơn về tương đối.
  - Triage mono không tự động hoá được: ~114 file phải đọc bằng mắt.
  - Vibrancy bị hoãn ⇒ sidebar vẫn đục trong khi Finder/Mail trong suốt. Chấp nhận, đổi lấy đợt này review được.
- **Việc cần làm tiếp:**
  - Chạy hai codemod (P2), triage mono (P3), rồi **nối guard vào `pnpm lint`** (bước cuối P4).
  - Cập nhật [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md) + [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md) để rule mới thay rule "dùng `text-[1em]`".
  - Sửa **13 site `border-radius: var(--r)`** — biến `--r` không được khai ở đâu trong repo, nên radius rơi về 0. Guard đã bắt.
  - Quyết định riêng cho vibrancy (P5) nếu còn muốn làm.

## Tham chiếu

- Feature: [docs/features/native-macos-polish.md](../features/native-macos-polish.md) (plan + scan + thứ tự thi công)
- Token có sẵn: [ADR 0072 — Theme family "Cute"](./0072-cute-theme-family.md) (D-7 khai `--r-*` / `--dur-*`)
- Tài liệu bị thay: [ADR 0041 — Design system in-house kiểu shadcn](./0041-in-house-design-system-shadcn-style.md), [ADR 0044 — shadcn-vue thật](./0044-adopt-shadcn-vue-real.md), [docs/features/ui-design-system.md](../features/ui-design-system.md) — mô tả `apps/desktop/ui/components/ui/`, thư mục đã bị xoá khi rebuild sang `ui-next`.
- Coding rule: [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md), [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md)
