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

- `scripts/check-design-tokens.mjs` (Node thuần, **không thêm dep** → không cần ADR cho dep) nối vào `pnpm lint`. Fail khi: `border-radius: <px>` không phải `var(--r-*)`/`50%` (R1), `font-size: <rem>` không phải `var(--fs-*)` (R2), `var(--code)` ở file ngoài allowlist (R3), `line-height` là hệ số lẻ / px lẻ (R4). Allowlist đặt trong chính script.
- Cập nhật [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md) + [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md).
- **Dọn tài liệu chết:** [ui-design-system.md](./ui-design-system.md) + [ADR 0041](../decisions/0041-in-house-design-system-shadcn-style.md) trỏ vào `apps/desktop/ui/` đã bị xoá → đánh dấu Superseded hoặc viết lại cho `ui-next`.
- **ADR mới (0079)** cho quyết định thang token + native window chrome.

## 5. Thứ tự thi công

| Phase | Workstream | Trạng thái | File đụng | Commit |
|---|---|---|---|---|
| **P0** | W1 + W2 | ✅ | 10 | `32b7e3f` |
| **P1** | W6 + W7 | ✅ — W7(a) huỷ, xem §4 | 31 | `516576f` |
| **P2** | W3 + W4 (codemod) | ✅ | 225 | `b6f2de2` |
| **P3** | W5 (mono triage) | ✅ — 85 giữ / 167 đổi | 113 | `a8a04c0` |
| **P4** | W8 (guard + docs + ADR) | ✅ — guard nối vào `pnpm lint` | 7 | `a49a68f` + `b323405` |
| **P5** *(chưa làm, cần ADR riêng)* | Vibrancy / translucency | ⬜ | toàn bộ thang màu | — |

Mỗi phase = 1 commit riêng theo [.claude/rules/git-commit.md](../../.claude/rules/git-commit.md). P2 tách 2 commit (radius / type).

## 6. Checklist chống sót

Chạy sau mỗi phase, trong `apps/desktop/ui-next/`:

```bash
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
