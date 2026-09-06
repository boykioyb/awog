# Feature — Native macOS polish (ui-next)

> Trạng thái: **P0–P4 đã land** (2026-09-06, branch `feature/native-macos-polish`). P5 (vibrancy) chưa bắt đầu — cần ADR riêng.
> Scan gốc thực hiện 2026-09-06 trên `main` @ v0.33.0.
> Mục tiêu: bỏ cảm giác "web page nhét trong cửa sổ" của app desktop, không đổi kiến trúc, không thêm dependency.

## 1. Vấn đề

App đọc như một trang web đặt trong khung Electron chứ chưa như một app macOS. Nguyên nhân gốc: CSS được **port verbatim** từ prototype web (xem comment đầu [app-shell.css](../../apps/desktop/ui-next/assets/css/app-shell.css) — prototype render `.app` như một "showcase card" giữa trang), và lớp primitive dùng chung đã **mất trong lần rebuild sang `ui-next`**.

**Phát hiện phụ (cần xử lý riêng):** [ui-design-system.md](./ui-design-system.md) và [ADR 0041](../decisions/0041-in-house-design-system-shadcn-style.md) mô tả `apps/desktop/ui/components/ui/AppButton.vue` — thư mục `apps/desktop/ui/` **không còn tồn tại**, và `ui-next/components/ui/` **rỗng** (0 usage `AppButton`). Hai tài liệu đó đang stale và mô tả code đã bị xoá.

## 2. Kết quả scan

| Hạng mục | Số liệu | Nguồn |
|---|---:|---|
| File `.vue` | 298 (255 có `<style>`) | `components/ layouts/ pages/` |
| `<button>` viết tay | 752 | không có primitive |
| `border-radius` (px) | **702 site / 18 giá trị** | 7px(78) 8px(151) 6px(124) 9px(41) 12px(54) 10px(48) 5px 4px 11px 13px 3px 2px 1px 14px 16px 99px 999px 9999px |
| `border-radius: 50%` | 63 | vòng tròn — **giữ nguyên** |
| `font-size` rem | **727 site / 15 giá trị** | nhiều giá trị ra **nửa pixel** (xem §3.3) |
| `font-size` px cố định | 219 (`12px`) | badge/hint — **cố ý**, giữ |
| Token `--r-*` được dùng | 50 / 702 (7%) | scale khai ở [prototype.css:24](../../apps/desktop/ui-next/assets/css/prototype.css) nhưng comment tự thú "no existing rule reads them" |
| Token `--dur-fast` được dùng | **0** | |
| `:hover` | 366 (139 file) | |
| `:active` | **26** (15 file) | tỉ lệ 1 : 14 |
| `transition:` | 164 | |
| `:focus-visible` | 47 | |
| `var(--code)` trên chữ UI | 267 site (114 file) + 340 tham chiếu class `.mono` | |
| `text-transform: uppercase` | 59 site (33 file) | |
| `::-webkit-scrollbar` | 14 declaration | luôn hiện, dày 10px |
| `.on` (selection state) | 127 selector | |
| `-webkit-app-region` | **0** | không kéo được cửa sổ từ top bar |
| `titleBarStyle` / `vibrancy` | **0** | title bar macOS mặc định trên app tối |

## 3. Quyết định nền

- **D1 — Token hoá, không sửa tay.** 702 + 727 site không thể sửa thủ công mà không sót. Dùng **codemod** (`scripts/`, Node thuần, không dep mới) + **guard script** chạy trong `pnpm lint`.
- **D2 — Type scale phải cho ra px nguyên ở MỌI base.** Appearance cho phép `--font-size-base` 12→18. Dùng `calc(base ± Npx)` chứ **không** dùng rem lẻ → không bao giờ rơi vào nửa pixel.
- **D3 — Mono chỉ cho code thật.** Phần lớn 267 site dùng mono để *căn số*, không phải vì là code. Thay bằng `font-variant-numeric: tabular-nums` trên `--sans` → được căn số mà mất vẻ terminal.
- **D4 — Vibrancy / translucency tách thành phase riêng, opt-in.** `vibrancy: 'sidebar'` chỉ ăn khi bề mặt trong suốt; làm `.side` trong suốt buộc phải retune lại toàn bộ thang tương phản (dark + light + Cute). Không gộp vào đợt này.
- **D5 — Ngoại lệ được giữ nguyên** (§8), khai báo tường minh để guard script không báo giả.

## 4. Workstream

### W1 — Window chrome & drag region (Electron)

| File | Việc |
|---|---|
| [window.ts:126](../../apps/desktop/electron/src/window.ts) | `darwin`: `titleBarStyle: 'hiddenInset'` + `trafficLightPosition: {x:14,y:15}`. `win32`/`linux`: `titleBarStyle: 'hidden'` + `titleBarOverlay` (màu theo theme). Mọi nền tảng: `backgroundColor` (chống nháy trắng). |
| [window.ts](../../apps/desktop/electron/src/window.ts) | Phát `window:fullscreen` (`enter-full-screen`/`leave-full-screen`) — fullscreen thì đèn giao thông biến mất, inset phải rút. |
| [session-window.ts:88](../../apps/desktop/electron/src/session-window.ts) | Popout session: cùng treatment. **Quyết định cần chốt**: giữ frame native (title do OS vẽ) hay hidden + title trong page. |
| [popover.ts:22](../../apps/desktop/electron/src/popover.ts) | Đã frameless. Thêm `vibrancy: 'popover'` (mac) + bo góc → giống popover menu-bar thật. |
| [browser.ts:61](../../apps/desktop/electron/src/browser.ts) | **Không đụng** — cửa sổ browser nhúng nên giữ frame native. |
| [pet-window.ts](../../apps/desktop/electron/src/pet-window.ts) | **Không đụng**. |
| [preload.ts](../../apps/desktop/electron/src/preload.ts) | Expose `platform` + `onFullscreen`. Renderer set `body[data-platform]` / `body[data-fullscreen]`. |

CSS đi kèm:
- `.top` ([app-shell.css:168](../../apps/desktop/ui-next/assets/css/app-shell.css)) → `-webkit-app-region: drag`; **mọi** con tương tác (`button`, `input`, `.kbd`, `.shelltgl`, `TopBarNotifications`) → `no-drag`.
- `.side` ([app-shell.css:131](../../apps/desktop/ui-next/assets/css/app-shell.css)) → `padding-top` +28px khi `body[data-platform='darwin']:not([data-fullscreen])`.
- **Bẫy rail thu gọn:** `.side.collapsed` rộng 58px ([prototype.css:608](../../apps/desktop/ui-next/assets/css/prototype.css)) trong khi 3 đèn chạy tới x=66 → đèn straddle đường phân cách rail/main và tràn lên top bar. Trên macOS nới rail thu gọn lên 78px để đèn nằm trọn trong rail — giữ **một** quy tắc duy nhất cho cả shell: *đèn luôn ngồi trên rail*.
- **Bẫy compact mode (≤1100px):** NavRail thu thành drawer, `.side` không còn ở cột trái → đèn giao thông đè lên `.top`. Ở compact, inset phải chuyển sang `padding-left` của `.top`. Xem `.app.compact .side` ([app-shell.css:222](../../apps/desktop/ui-next/assets/css/app-shell.css)).
- `.top` height 44px → 52px trên macOS (toolbar thật ~52px).

**Rủi ro:** `backgroundColor` lúc tạo cửa sổ chưa biết theme (theme nằm ở localStorage của renderer) → user theme sáng vẫn nháy tối 1 frame. Giảm nhẹ bằng `show:false` + `ready-to-show` (đã có); nếu muốn triệt để thì persist theme ra `userData/window-state.json`.

### W2 — Press / hover / focus states

Tỉ lệ 366 `:hover` : 26 `:active` là nguyên nhân trực tiếp của cảm giác "bấm không ăn".

- Thêm vào [app-shell.css](../../apps/desktop/ui-next/assets/css/app-shell.css) một block toàn cục cho các họ class tương tác: `button, [role='button'], .btn, .iconbtn, .ni, .li, .gsi, .chip, .chipbtn, .act, .cact, .codetab, .shelltgl`.
  - `transition: background-color var(--dur-fast) var(--ease), color …, border-color …` (hiện `--dur-fast` **chưa được dùng lần nào**).
  - `:active` → token mới `--bgPress` (nền trung tính) cho control rỗng; `filter: brightness(.92)` cho control nền đặc (`.btn.pri`).
  - `:focus-visible` fallback ring dùng `--shadow-glow` (đã khai, ít dùng).
- Audit 26 `:active` sẵn có để không xung đột.
- Một block `@media (prefers-reduced-motion: reduce)` toàn cục (hiện 10 block rải rác, không phủ hết).

### W3 — Type scale

Khai ở `:root` ([prototype.css:9](../../apps/desktop/ui-next/assets/css/prototype.css)):

```
--fs-xs:  calc(var(--font-size-base) - 2px);   /* 11 @base13 */
--fs-sm:  calc(var(--font-size-base) - 1px);   /* 12 */
--fs-md:  var(--font-size-base);               /* 13 — body */
--fs-lg:  calc(var(--font-size-base) + 2px);   /* 15 */
--fs-xl:  calc(var(--font-size-base) + 4px);   /* 17 */
--fs-2xl: calc(var(--font-size-base) + 9px);   /* 22 */
```

Nguyên px ở mọi base 12→18. Codemod `scripts/codemod-type-scale.mjs` map 727 site:

| rem hiện tại | = px @13 | → token |
|---|---:|---|
| `0.6923` `0.7692` `0.8077` `0.8462` | 9 / 10 / 10.5 / 11 | `--fs-xs` |
| `0.8846` `0.9231` `0.9615` | **11.5** / 12 / **12.5** | `--fs-sm` |
| `1` `1.0385` | 13 / **13.5** | `--fs-md` |
| `1.0769` `1.1154` `1.1538` | 14 / 14.5 / 15 | `--fs-lg` |
| `1.3846` | 18 | `--fs-xl` |
| `1.6923` | 22 | `--fs-2xl` |
| `2.4615` | 32 | **giữ nguyên** (hero/empty state) |

**Leading đi kèm (2026-09-06, hoàn tất D2).** `html,body{line-height:1.5}` là **hệ số không đơn vị** nên nó nhân lại với font-size và trả nửa pixel về ngay sau khi type scale khử xong (`--fs-md` 13px × 1.5 = 19.5px; đo trên app đang chạy: **75%** element được vẽ nằm trên nửa pixel, `.ni` cao 35.5px). Ba bước:

1. `:root` thêm 7 token `--lh-*` khai bằng `calc(var(--font-size-base) + Npx)` (+3 / +5 / +7 / +9 / +11 / +15, và `--lh-prose` +9) ⇒ **px nguyên ở cả 6 base** 12/13/14/15/16/18.
2. `html,body{line-height:var(--lh-md)}` — giá trị **có đơn vị** kế thừa xuống dưới dạng độ dài cố định, không nhân lại với font-size của con.
3. Codemod `scripts/codemod-line-height.mjs` ghép cặp: rule khai `font-size: var(--fs-X)` mà chưa có leading ⇒ thêm `line-height: var(--lh-X)` (**605 site**); rule ghim `font-size` bằng px cố định ⇒ thêm `line-height: <round(1.5 × px)>px` (**152 site**, 146 trong đó là `12px → 18px`, đúng bằng giá trị đang render nên hình học không đổi).

Văn bản dài lấy `--lh-prose` (22px trên chữ 13px = 1.69): `.mdbody` (markdown.css + 4 bản scoped), `.mdinline` (bong bóng chat), `.ghmdbody` (issue/PR body). Code block lấy `--lh-sm` (18px). Heading trong prose giữ hệ số `1.3` kèm marker `design-token-ok` — font-size của chúng là `em` (ngoại lệ §8) nên không tồn tại leading nguyên chung cho cả nhóm h1…h6.

Rule **đã tự khai** `line-height` thì codemod không đụng: **173 site / 97 file** còn hệ số lẻ, khai trong `LEGACY_COEFFICIENTS` của guard dưới dạng trần đếm theo file (chỉ được giảm) — chờ duyệt bằng mắt từng file.

**Codemod chỉ đụng `rem`.** Giá trị `em` (108× `1em` + ~30 giá trị `em` khác) là **tương đối với cha** — map sang token tuyệt đối sẽ đổi ngữ nghĩa. 219× `font-size: 12px` là badge/hint cố ý không scale ([.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md)) → giữ, có thể đặt tên `--fs-badge: 12px`.

### W4 — Radius scale

Ép 702 site / 18 giá trị về 6 token đã khai sẵn:

| px hiện tại | → token | px mới |
|---|---|---:|
| 1 2 3 4 5 6 7 | `--r-xs` | 6 |
| 8 9 | `--r-sm` | 8 |
| 10 11 12 | `--r-btn` | 10 |
| 13 14 | `--r-card` | 14 |
| 16 | `--r-panel` | 16 |
| 99 999 9999 | `--r-pill` | 999 |
| `50%` (63 site) | **giữ nguyên** | — |

Codemod `scripts/codemod-radius.mjs`. **Phải chạy cả trên [theme-cute.css](../../apps/desktop/ui-next/assets/css/theme-cute.css)** (49 site) — bỏ sót là 2 theme lệch nhau.

### W5 — Mono → sans + tabular-nums

Đây là workstream **duy nhất cần mắt người** (267 site + 340 tham chiếu `.mono`), vì phân loại theo ngữ nghĩa chứ không theo cú pháp.

| Bucket | Ví dụ | Xử lý |
|---|---|---|
| **Giữ mono** | code block, diff, terminal, file path, SHA, JSON viewer | không đổi |
| **Đổi sang sans + `tabular-nums`** | timestamp (`.tm`), count (`.ct`), badge (`.bdg`), chip (`.chip`), tag (`.tag`), section header (`.sech` `.navg` `.gsec`), subtitle (`.dsub`), avatar (`.ava`), phím tắt (`.kk`) | thêm class `.tnum` |

Quy trình: sinh inventory bằng script → duyệt theo file → apply. Thêm `.tnum { font-variant-numeric: tabular-nums }` vào [prototype.css](../../apps/desktop/ui-next/assets/css/prototype.css).

### W6 — Scrollbar overlay

[prototype.css:56-62](../../apps/desktop/ui-next/assets/css/prototype.css): thumb mặc định `transparent`, chỉ hiện khi `:hover` **chính element đang cuộn**; thu bề rộng 10px → 8px.

Ngoại lệ **không đụng**: xterm tự vẽ scrollbar DOM riêng ([WorkspaceTerminal.vue:1141](../../apps/desktop/ui-next/components/session/workspace/WorkspaceTerminal.vue) đã `scrollbar-width:none`), Monaco tự vẽ, [SessionTabBar.vue:617](../../apps/desktop/ui-next/components/session/SessionTabBar.vue) và [WorkspaceCost.vue:188](../../apps/desktop/ui-next/components/session/workspace/WorkspaceCost.vue) đã ẩn chủ động.

### W7 — Selection & label idiom

- **HUỶ (2026-09-06).** Bản plan đầu chốt đổi `.ni.on` / `.li.on` / `.libli.on` sang nền `--bgActive` + thanh accent inset. **Sai** — đúng thay đổi đó đã từng thực hiện và **user đã bác**: "gray/quê, selection phải CÓ MÀU, không phải xám". Selection state của sidebar/list **giữ nguyên accent-tint** (`--accentDim` + `--accentBorder` + thanh accent 2px). Không đụng tới.
- Phần còn giá trị của W7(a): rà 129 rule block `.on` để **phát hiện** chỗ lệch chuẩn, chứ không đồng loạt chuyển sang xám. Ghi nhận từ lần rà: `.sshsess-row.on` đánh dấu selection **chỉ bằng màu chữ**, yếu hơn mọi list khác; `.ostab.on` và `.ntf-tab.on` mang 2 tín hiệu accent (border + text) mà không có fill. Ba chỗ này để lại, xử lý khi user than phiền.
- Ghi chú đếm: grep thô ra ~150 hit vì dính `onSelect` / `onDidChangeContent` / `git.stash.onBranch`; số rule block CSS thật là **129**.
- Bỏ `text-transform: uppercase` + `letter-spacing: .06–.08em` ở label sidebar/section (33 file, 59 site) — idiom Material, không phải macOS. Giữ uppercase ở nơi thật sự là nhãn kỹ thuật (badge trạng thái).
- **Cảnh báo đếm sai (đã gặp):** 16/59 site đó **đã** bị vô hiệu từ trước bởi một override trong `app-shell.css` (commit `8e3292c`) — sửa mỗi rule gốc là no-op trên màn hình. Đồng thời `prototype.css:823` cộng lại `letter-spacing:.06em` **sau** override đó. Muốn thấy thay đổi thật thì phải gỡ cả ba tầng.

### W8 — Guard & tài liệu

- `scripts/check-design-tokens.mjs` (Node thuần, **không thêm dep** → không cần ADR cho dep) nối vào `pnpm lint`. Fail khi: `border-radius: <px>` không phải `var(--r-*)`/`50%` (R1), `font-size: <rem>` không phải `var(--fs-*)` (R2), `var(--code)` ở file ngoài allowlist (R3), `line-height` là hệ số lẻ / px lẻ (R4), cỡ icon px lẻ (R5), `padding`/`margin`/`gap` px lẻ ngoài ±1px (R6). Allowlist đặt trong chính script.
- Cập nhật [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md) + [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md).
- **Dọn tài liệu chết:** [ui-design-system.md](./ui-design-system.md) + [ADR 0041](../decisions/0041-in-house-design-system-shadcn-style.md) trỏ vào `apps/desktop/ui/` đã bị xoá → đánh dấu Superseded hoặc viết lại cho `ui-next`.
- **ADR mới (0079)** cho quyết định thang token + native window chrome.

### W9 — Icon scale (P7b)

P7a đưa mọi **hộp dòng** về px nguyên và kéo tỉ lệ element nằm trên nửa pixel từ 75% → **47%**. Đo phần 47% còn lại trên app đang chạy: gần như toàn bộ là **SVG icon**.

| cỡ icon | số lượng | nằm trên nửa pixel |
|---|---:|---:|
| 15px (lẻ) | 26 | **25** |
| 13px (lẻ) | 2 | 0 |
| 14px (chẵn) | 2 | 2 |

Cơ chế: `.icn{width:15px}` căn giữa trong hàng cao 36px ⇒ `(36 − 15) / 2 = 10.5px`. Icon ngồi trên biên nửa pixel, `stroke-width: 1.7` lại là **user unit** của viewBox `0 0 24 24` nên nét vẽ thật là `1.7 × 15/24 = 1.06px` — cũng không phải số nguyên. Hai lỗi cộng vào nhau ⇒ icon mềm/nhoè.

Thang chốt ở `:root` của [prototype.css](../../apps/desktop/ui-next/assets/css/prototype.css), **px cố định** (icon là hình vẽ, phình theo Appearance là tràn container):

```
--icon-xs:12px; --icon-sm:14px; --icon-md:16px; --icon-lg:20px; --icon-xl:24px;
```

- `.icn` global **15 → 16px** (`--icon-md`). Chọn 16 chứ không 14 vì `24 / 16 = 1.5` chẵn ⇒ `stroke-width: 1.5` ra **đúng 1 device pixel**; 16pt cũng là cỡ icon sidebar/toolbar của macOS. Đã rà toàn bộ hộp vuông có `place-items:center` cỡ 14–26px: mọi hộp chật (`.tdck` 15, `.qcbox`/`.lcbox`/`.att .qsend`/`.wsterm-tab-close` 16, `.sshx-tab-x` 17) đều nhồi icon bằng **cỡ inline tường minh** (11/12px), không ăn `.icn` mặc định ⇒ không tràn. Hàng chữ + icon thì chiều cao do hộp dòng `--lh-md` 20px quyết định, 16px không chạm trần.
- `stroke-width` **1.7 → 1.5**. 2 sẽ ra 1.33px và nhìn nặng ở cỡ 16.
- `.logo` **25 → 26px** (sửa tay): tile lẻ căn glyph vào 5.5px, và [theme-cute.css](../../apps/desktop/ui-next/assets/css/theme-cute.css) vốn đã dùng 26 — để 25 là hai theme family lệch nhau.

Codemod [`scripts/codemod-icon-scale.mjs`](../../apps/desktop/ui-next/scripts/codemod-icon-scale.mjs) + guard **R5**. Cỡ lẻ map **lên** bậc chẵn (icon không teo): 11→12, 13→14, 15→16, 21→22, 9→10; cỡ chẵn nằm trên thang thì đổi sang token, cỡ chẵn ngoài thang (18/22/26/28/40 — icon empty-state) giữ nguyên px.

**Ba kênh khai cỡ icon** — bỏ sót kênh nào là guard mù kênh đó:

| kênh | ví dụ | số declaration |
|---|---|---:|
| `css` | `.ha .icn{width:13px;height:13px}` | 196 |
| `inline` | `<Icon style="width: 13px; height: 13px" />` | 1352 |
| `size` | `<ChevronLeft :size="15" />` (prop của lucide) | 22 |

**Heuristic phân biệt icon vs không-icon** nằm ở [`scripts/lib/icon-sites.mjs`](../../apps/desktop/ui-next/scripts/lib/icon-sites.mjs) và **dùng chung** cho codemod + guard (khác R1–R4, vốn tự chứa): không đoán theo tên class mà **học từ template**. Một pass quét mọi `.vue`, gom class đứng trên `<Icon>` / `<svg>` / component import từ `lucide-vue-next` vào một tập, class đứng trên element khác vào tập kia; **tên xuất hiện ở cả hai là nhập nhằng ⇒ KHÔNG phải icon**. Rule CSS được coi là icon khi **mọi** nhánh của selector list có key compound là `.icn` / `svg` / một class đã học; pseudo-element (`::after`) luôn bị loại vì nó là hình vẽ chứ không phải icon.

Kết quả học: **102 class icon**. Heuristic loại đúng các bẫy `width == height` mà một luật "vuông ⇒ icon" sẽ nhận nhầm: `.tog::after` / `.slider::after` (núm switch), `.cursor` (caret), `.thumb` (ảnh đính kèm), `.*-dot` (chấm trạng thái), `.catsq` (ô màu), `.gspin-ring` / `.sttspin` / `.acrspin` (spinner CSS trên `<span>`), `.ghskbar` / `.skbar` (thanh skeleton), `.ni .bdg` / `.ntf-badge` (badge chữ), `.donut` (gauge usage), `<Background :size="1">` của VueFlow.

Cần mắt người sau khi land: NavRail, list session, composer, top bar, status bar — xem §7.

### W10 — Spacing: khử số lẻ (P8a)

Sau P7a (leading) + P7b (icon), phần nửa pixel còn lại rơi vào **spacing**. Scan: **2397 declaration** `padding`/`margin`/`gap` có px, trong **246 file**; chỉ 34% nằm trên lưới 4pt, **918 con số là lẻ** (`8px` ×461 · `6px` ×357 · `10px` ×344 · `12px` ×248 · `9px` ×215 · `7px` ×188 · `4px` ×216 · `5px` ×134 · `11px` ×136 · `3px` ×111 …). 30 giá trị padding + 19 giá trị gap khác nhau — không có nhịp nào.

**Cố ý đi một bước vừa phải, KHÔNG nhảy thẳng lên lưới 4pt.** Ép `9 → 12` dịch **3px** và làm wrap/overflow ở hàng trăm chỗ không ai review nổi. Đợt này chỉ **khử số lẻ**, mỗi giá trị dịch **tối đa 1px**:

| lẻ | → chẵn | lẻ | → chẵn |
|---:|---:|---:|---:|
| 3 | 2 | 11 | 10 |
| 5 | 4 | 13 | 12 |
| 7 | 6 | 15 | 14 |
| 9 | 8 | 17 | 16 |

Làm tròn **XUỐNG** (chật hơn): thu một khoảng cách thì không bao giờ gây overflow, nới thì có. **`±1px` giữ nguyên** (69 site) — 1px là nudge quang học hoặc bù chiều dày hairline, không phải nhịp, và cả `0` lẫn `2` đều sai.

Codemod [`scripts/codemod-spacing.mjs`](../../apps/desktop/ui-next/scripts/codemod-spacing.mjs) (dùng lại `scripts/lib/css-sites.mjs`) + guard **R6**. Chỉ đụng `padding*` / `margin*` / `gap` / `row-gap` / `column-gap`; **không** đụng `width`/`height`/`top`/`left`/`inset`/`transform` — đó là **hình dạng**, không phải nhịp. Shorthand giữ nguyên số lượng giá trị (`padding: 7px 9px` → `6px 8px`).

Kết quả: **753 site / 169 file**, 849 con số đổi, **48 → 39 giá trị** khác nhau, **918 → 69 số lẻ** (toàn bộ là ±1px). Hệ quả density: mọi control lấy chiều cao từ padding **thấp đi 2px** — `.btn` 34 → 32, `.ni` (hàng NavRail) 36 → 34, `.li` 66 → 64. Tất cả đều **chẵn**, tất cả đều đo được (xem §6).

**KHÔNG token hoá spacing lần này.** `--sp-*` là đợt sau, khi đã biết bộ giá trị còn lại là gì.

### W11 — Leading phải CHẴN ở mọi base (P8b)

P7a khai `--lh-*` bằng `calc(var(--font-size-base) + Npx)` ⇒ **nguyên** ở mọi base, nhưng **chẵn/lẻ đổi theo base**: `--lh-md = base + 7` ra 20 ở base 13 (chẵn ✓) nhưng **19 / 21 / 23** ở base 12 / 14 / 16. Hộp dòng lẻ thì icon **chẵn** căn giữa lại rơi vào nửa pixel (`(19 − 16) / 2 = 1.5`) — đúng cái P7b vừa khử. Bảo đảm cũ chỉ đúng ở base 13 và 15.

Sửa bằng `round()` của CSS (Chrome 125+; Electron 33 = Chromium 130):

```
--lh-md: round(up, calc(var(--font-size-base) * 1.5), 2px);
```

Hệ số chọn sao cho **base 13 giữ đúng giá trị cũ**: `xs 1.2 · sm 1.35 · md 1.5 · lg 1.6 · xl 1.8 · 2xl 2.1 · prose 1.65`.

**Đã verify `round()` thật sự resolve, không giả định**: `CSS.supports('line-height','round(up, 19.5px, 2px)')` → `true`, và `getComputedStyle` trên element gắn token, đọc từ **CSS đã build** (`.output/public/_nuxt/entry.*.css`) trong Electron 33 — không phải một data-URL viết tay:

| base | `--lh-xs` | `--lh-sm` | `--lh-md` | `--lh-lg` | `--lh-xl` | `--lh-2xl` | `--lh-prose` |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 12 | 16 | 18 | 18 | 20 | 22 | 26 | 20 |
| **13** | **16** | **18** | **20** | **22** | **24** | **28** | **22** |
| 14 | 18 | 20 | 22 | 24 | 26 | 30 | 24 |
| 15 | 18 | 22 | 24 | 24 | 28 | 32 | 26 |
| 16 | 20 | 22 | 24 | 26 | 30 | 34 | 28 |
| 18 | 22 | 26 | 28 | 30 | 34 | 38 | 30 |

42/42 ô chẵn — `round(…, 2px)` bảo đảm điều đó bằng cấu tạo, bảng chỉ là bằng chứng nó chạy. Hàng base 13 (in đậm) trùng khít giá trị của P7a ⇒ mặc định không đổi hình.

Đánh đổi: thang chuyển từ **offset** sang **tỉ lệ**, nên ở base 18 hộp dòng cao hơn bản offset ~2–3px (md 28 thay vì 25). Chấp nhận: leading *nên* giãn theo cỡ chữ, và base 18 là mức Appearance ít dùng nhất.

### W12 — Hairline không được ăn vào layout box (P8c)

18 element lỗi thật còn lại sau P7b đều cùng một pattern: **thanh cao cố định + `border-bottom: 1px` + con căn giữa**. Vì `* { box-sizing: border-box }` nên border ăn mất 1px của **content box** (44 → 43) và mọi con căn giữa rơi vào nửa pixel: `(43 − 28) / 2 = 7.5`. Đo được 11 hộp + 7 SVG root đúng ở toạ độ đó, đều trong top bar (`.shelltgl`, `.ntf`, `.ntf-btn`, `.icn`).

Sửa: vẽ đường kẻ bằng **`box-shadow: inset 0 -1px 0 <màu>`** — shadow không chiếm chỗ trong layout nên content box giữ số chẵn. **`inset` chứ không outset**: shadow outset bị **background của sibling kế tiếp** vẽ đè (thứ tự cây trong thuật toán paint), tức là mất hẳn đường kẻ; inset vẽ trong padding box nên chỉ có **con của chính nó** mới che được, và ở cả 6 rule dưới đây con cao nhất là 32px trong hộp ≥ 30px có padding — không chạm mép dưới.

| Rule | Chiều cao | content box trước → sau |
|---|---:|---|
| `.top` ([prototype.css](../../apps/desktop/ui-next/assets/css/prototype.css)) | 44 (52 macOS · 46 cute) | 43 → **44** (51 → **52** · 45 → **46**) |
| `.dh` ([prototype.css](../../apps/desktop/ui-next/assets/css/prototype.css)) | 50 (54 cute) | 49 → **50** (53 → **54**) |
| `.edtop` ([EditorTopBar.vue](../../apps/desktop/ui-next/components/editor/EditorTopBar.vue)) | min 44 | 27 → **28** (trừ `padding: 8px 14px`) |
| `.gterm-head` ([GlobalTerminalHost.vue](../../apps/desktop/ui-next/components/shell/GlobalTerminalHost.vue)) | 30 | 29 → **30** |
| `.tsr-head` ([TerminalSnippetsRail.vue](../../apps/desktop/ui-next/components/shell/TerminalSnippetsRail.vue)) | 30 | 29 → **30** |
| `body[…='cute'] .gterm-head` ([theme-cute.css](../../apps/desktop/ui-next/assets/css/theme-cute.css)) | 32 | 31 → **32** |
| `body[…='cute'] .tsr-head` ([theme-cute.css](../../apps/desktop/ui-next/assets/css/theme-cute.css)) | 30 | 29 → **30** |
| `.gterm--collapsed .gterm-head` | — | `border-bottom: 0` → `box-shadow: none` |

Hai override trong `theme-cute.css` **bắt buộc** đi cùng: chúng khai lại `border-bottom` với màu terminal, để nguyên thì theme Cute vừa mất fix vừa có hai đường kẻ.

Đo lại trên CSS đã build trong Electron 33: `.top` content box **44** (con `.btn` cao 32 ở `top = 6`, trước là 5.5), `.dh` content box **50** (`top = 9`, trước 8.5).

**Phạm vi hẹp lại có chủ đích.** Chỉ rule vừa có `height`/`min-height` **cố định**, vừa có `border-top`/`border-bottom` 1px, **và** căn giữa con theo trục dọc. **Không** migrate toàn bộ border của app sang box-shadow — đó là thay đổi khác, rủi ro cao.

Hai rule tìm thấy nhưng **cố ý để lại**, cần quyết định riêng:

- **`.stabs`** ([SessionTabBar.vue](../../apps/desktop/ui-next/components/session/SessionTabBar.vue)) — `align-items: stretch`, không phải `center`, nên nằm ngoài tiêu chí. Nó *có* cùng lỗi (tab con cao 37 − 2px border = 35, chữ 20px ⇒ 7.5), nhưng `.stab.on` có **nền accent trải hết chiều cao** nên inset shadow sẽ bị nó che, còn outset thì bị nội dung phía dưới che. Cần một cách khác (`::after` tuyệt đối, hoặc `min-height: 39px`).
- **`.oshead, .oscorner`** ([OfficeSheetView.vue](../../apps/desktop/ui-next/components/common/OfficeSheetView.vue)) — ô `<th>` sticky, căn giữa bằng `vertical-align` mặc định chứ không phải `align-items`, và còn `border-right` trên trục kia. Đường kẻ ở đây là **lưới bảng tính**, đổi sang shadow rủi ro hơn lợi (26 → 25, lệch 3.5px cho hộp dòng 18px).

## 5. Thứ tự thi công

| Phase | Workstream | Trạng thái | File đụng | Commit |
|---|---|---|---|---|
| **P0** | W1 + W2 | ✅ | 10 | `32b7e3f` |
| **P1** | W6 + W7 | ✅ — W7(a) huỷ, xem §4 | 31 | `516576f` |
| **P2** | W3 + W4 (codemod) | ✅ | 225 | `b6f2de2` |
| **P3** | W5 (mono triage) | ✅ — 85 giữ / 167 đổi | 113 | `a8a04c0` |
| **P4** | W8 (guard + docs + ADR) | ✅ — guard nối vào `pnpm lint` | 7 | `a49a68f` + `b323405` |
| **P7b** | W9 (icon scale + guard R5) | ✅ — 1482 declaration / 169 file | 169 | — |
| **P8** | W10 + W11 + W12 (spacing / leading chẵn / hairline) | ✅ — 753 site spacing, 42/42 ô leading chẵn, 8 rule hairline | 176 | — |
| **P5** *(chưa làm, cần ADR riêng)* | Vibrancy / translucency | ⬜ | toàn bộ thang màu | — |

Mỗi phase = 1 commit riêng theo [.claude/rules/git-commit.md](../../.claude/rules/git-commit.md). P2 tách 2 commit (radius / type).

## 6. Checklist chống sót

Chạy sau mỗi phase, trong `apps/desktop/ui-next/`:

```bash
node scripts/check-design-tokens.mjs                    # R1–R6, phải 0 vi phạm
node scripts/codemod-icon-scale.mjs --dry-run           # phải 0 site (idempotent)
node scripts/codemod-spacing.mjs --dry-run              # phải 0 site (idempotent)
grep -rhoE 'border-radius: *[0-9]+px' components layouts pages assets/css | sort | uniq -c
grep -rhoE 'font-size: *[0-9.]+rem'   components layouts pages assets/css | sort | uniq -c
grep -rc 'var(--code)' components layouts pages assets/css | grep -v ':0$'
grep -rn 'text-transform: *uppercase' components layouts pages assets/css
grep -rn '::-webkit-scrollbar' components layouts pages assets/css
grep -rn 'app-region' components layouts pages assets/css
```

Kèm: `pnpm typecheck` (phải EXIT 0 — xem [project_ui_typecheck_broken]), `pnpm lint`, và **chạy app thật** trên cả 2 theme × 2 theme-family (`awog` / `cute`) × dark/light.

## 7. Bề mặt phải verify bằng tay

Codemod không bắt được lỗi thị giác. Duyệt tối thiểu: NavRail, TopBar, Sessions (transcript + composer + Workspace Panel 6 tab), Git Manager, Settings, Wiki, Workflow canvas (VueFlow), tray popover, session popout, compact mode ≤1100px, fullscreen.

## 8. Cố ý KHÔNG đổi

- `border-radius: 50%` (63 site) — vòng tròn.
- `font-size: 12px` cố định (219 site) — badge/hint không scale, theo rule hiện hành.
- `font-size` đơn vị `em` — tương đối với cha, khác ngữ nghĩa token.
- `2.4615rem` (32px) hero/empty state.
- Monaco, xterm, VueFlow — tự vẽ, không theo token hệ thống.
- [browser.ts](../../apps/desktop/electron/src/browser.ts), [pet-window.ts](../../apps/desktop/electron/src/pet-window.ts).
- [apps/desktop/remote-pwa/](../../apps/desktop/remote-pwa/) — PWA mobile, CSS riêng, ngoài phạm vi.

## 9. Rủi ro

| Rủi ro | Giảm nhẹ |
|---|---|
| Codemod bỏ sót `theme-cute.css` → 2 theme lệch | Đưa vào cùng glob, verify bằng checklist §6 |
| Radius 12→10 làm lệch bo góc lồng nhau (inner = outer − padding) | Duyệt tay các card lồng ở §7 |
| Inset đèn giao thông vỡ ở compact mode / fullscreen | Xử lý tường minh 2 nhánh (W1), test cả hai |
| `backgroundColor` không biết theme lúc tạo window | `show:false` + `ready-to-show`; persist theme nếu vẫn nháy |
| Type scale làm layout chật/rộng bất ngờ (14px → 15px) | Diff theo phase, duyệt §7 |
| Bỏ mono làm bảng số mất căn | `tabular-nums` bù lại; kiểm ở Cost tab, Git stats, usage ring |

## 10. Còn lại sau P0–P4

**Chưa verify bằng mắt** (không agent nào chạy được app) — xem §7:
- `trafficLightPosition {x:14,y:15}` với `.top` 52px, và `padding-left: 82px` ở compact mode — số suy ra, chưa đo pixel.
- ~~Rail thu gọn: đèn tràn ra ngoài~~ — **đã sửa** (`558d5ba`): rail thu gọn nới lên 78px trên macOS, đã đo đủ 4 nhánh (mở rộng / thu gọn / fullscreen / non-darwin).
- Windows/Linux `env(titlebar-area-width)` chưa test trên máy thật.
- Căn cột số sau khi bỏ mono: Cost tab, Activity, usage ring, Git sidebar (`↑2 / ↓33`).
- Va chạm radius lồng nhau ở 9 file từng có 12px ngoài + 10px trong.
- Wiki + Settings→Bộ nhớ: lần đầu render bo góc sau khi sửa bug `var(--r)`.

**Việc nhỏ tách riêng:**
- Đổi tên `.ssh-mono` / `.sshx-card-mono` → `-monogram` (mono ở đây là *monogram*, không phải monospace).
- Gỡ 2 override `font-family: var(--sans)` giờ đã thừa trong `theme-cute.css`.
- `check-design-tokens.mjs` giữ bản sao riêng của `SCAN_DIRS`/`SKIP_FILES`/`maskBlockComments` thay vì import `scripts/lib/css-sites.mjs` — cố ý để script tự chứa, nhưng phải sync tay.
- 3 chỗ selection lệch chuẩn để lại: `.sshsess-row.on` (chỉ đổi màu chữ), `.ostab.on` + `.ntf-tab.on` (2 tín hiệu accent, không fill).
- `[role='tab']` chưa nằm trong họ press-state của P0 nên session tab không có phản hồi khi bấm.
