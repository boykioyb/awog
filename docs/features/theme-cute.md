# Theme Cute — bộ giao diện mint/off-white opt-in

**Trạng thái:** Implemented (ui-next) — opt-in, mặc định TẮT (`awog` vẫn là theme mặc định). Xem [ADR 0072](../decisions/0072-cute-theme-family.md) cho quyết định + trade-off; tài liệu này là tham chiếu cho developer sẽ chạm vào UI tiếp theo.

## Là gì, bật ở đâu

"Cute" là theme family thứ hai bên cạnh `awog` (mặc định) — "a cute AI command center for developers": nền off-white/trắng thuần, brand mint/teal (`#14b8a6` ở light, `#2dd4bf` ở dark), phụ màu lavender, hairline thay border cứng, shadow layered mềm, một scale radius/motion duy nhất, màu trạng thái pastel. 90% vẫn là công cụ chuyên nghiệp — phần "cute" (mascot) chỉ xuất hiện ở logo, empty state, và một success flash.

Bật ở **Settings → Appearance → Theme**, đoạn segmented `AWOG | Cute | shadcn` (`SettingsAppearance.vue`). Chọn "Cute" ghi `settings.appearance.themeFamily = 'cute'` và áp `body[data-theme-family='cute']` ngay lập tức — không cần reload; bấm lại "AWOG" trả về y hệt giao diện cũ. `shadcn` là placeholder có từ trước ADR 0072, chưa có stylesheet nào implement — chọn nó hiện tại rơi về đúng giao diện AWOG.

Cơ chế nền: `stores/settings.ts` khai `ThemeFamily = 'awog' | 'shadcn' | 'cute'`; `composables/useAppearanceDom.ts` ghi giá trị đó thành thuộc tính `body[data-theme-family]` — hook này tồn tại từ trước, ADR 0072 là lần đầu có CSS thật sự đọc nó.

## Token

Toàn bộ khai trong `assets/css/theme-cute.css`, chia hai biến thể: `body[data-theme-family='cute']` (dark — mặc định) và `body.light[data-theme-family='cute']` (light — **đích thiết kế chính**). Giá trị dưới đây lấy nguyên văn từ file, không suy diễn.

### Surface ladder

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#191b1c` | `#fafcfc` |
| `--bgPanel` | `#1c1f20` | `#ffffff` |
| `--bgEl` | `#252829` | `#ffffff` |
| `--bgHover` | `#2b2f30` | `#f1f6f6` |
| `--bgActive` | `#343839` | `#e6efef` |
| `--bgRail` | `#151718` | `#f7fafa` |
| `--bgSubtle` | `#212425` | `#f6f9f9` |
| `--bgInput` | `#232627` | `#ffffff` |
| `--bgCanvas` | `#1d2021` | `#f3f7f7` |

Mỗi biến thể còn có override cho `[data-surface='flat']` và `[data-surface='deep']` (Appearance → Surface depth) — cùng logic với `app-shell.css` cho family `awog`, chỉ đổi màu chứ không đổi cấu trúc.

### Border + text ramp

| Token | Dark | Light |
|---|---|---|
| `--border` | `rgba(255,255,255,.075)` | `#e6eeee` |
| `--borderStrong` | `rgba(255,255,255,.14)` | `#d4e0e0` |
| `--text` | `#f2f5f5` | `#1f2937` |
| `--textMuted` | `#a7adad` | `#4b5563` |
| `--textDim` | `#8b9191` | `#6b7280` |
| `--textFaint` | `#6f7575` | `#9ca3af` |

### Brand + accent

| Token | Dark | Light | Ghi chú |
|---|---|---|---|
| `--accent` | `#2dd4bf` | `#14b8a6` | Brand mint/teal |
| `--accentText` | `#04211d` | `#ffffff` | Chữ/icon trên nền accent đặc |
| `--accentSoft` | `#1b3936` | `#e8faf7` | Fill pastel ĐẶC cho row/tab active — **chỉ tồn tại ở Cute** |
| `--accentHover` | `#5ce0d0` | `#0f9f91` | Hover của CTA đặc — **chỉ tồn tại ở Cute** |
| `--accentDim` | `rgba(45,212,191,.14)` | `rgba(20,184,166,.1)` | Wash trong suốt (dùng chung khái niệm với AWOG family) |
| `--accentBorder` | `rgba(45,212,191,.4)` | `rgba(20,184,166,.34)` | |
| `--violet` / `--lavender` | `#a3b0f8` | `#8b9cf6` | Phụ màu lavender, hai alias cùng giá trị |

`--accentSoft`/`--accentHover` được **derive lại thành `color-mix()` sống** bởi `useTheme().applyAccent()` khi user chọn accent tuỳ biến (Settings → Appearance → Accent) — giá trị tĩnh ở bảng trên chỉ là mặc định lúc chưa tuỳ biến. AWOG family không đọc hai token này nên việc pin luôn vô hại ở đó.

### Màu trạng thái (pastel, low-saturation)

| Token | Dark | Light |
|---|---|---|
| `--amber` (+`Dim`/`Border`) | `#f5b544` | `#f59e0b` |
| `--danger` (+`Dim`/`Bg`/`Border`) | `#f47171` | `#ef4444` |
| `--green` | `#4ade80` | `#22c55e` |
| `--add` / `--addBg` | `#86efac` | `#16a34a` |
| `--del` / `--delBg` | `#fca5a5` | `#dc2626` |
| `--mod` | `#fbbf24` | `#d97706` |

Dùng theo pattern tint-fill + text cùng hue + hairline cùng hue (§16 trong file) — không bao giờ block màu đặc trừ CTA chính.

### Shadow ramp

| Token | Dark | Light |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.26), 0 2px 8px rgba(0,0,0,.2)` | `0 1px 2px rgba(31,41,55,.04), 0 2px 8px rgba(31,41,55,.05)` |
| `--shadow-md` | `0 2px 12px rgba(0,0,0,.3), 0 10px 26px rgba(0,0,0,.34)` | `0 2px 12px rgba(31,41,55,.07), 0 10px 26px rgba(31,41,55,.07)` |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,.4), 0 24px 64px rgba(0,0,0,.5)` | `0 8px 28px rgba(31,41,55,.1), 0 24px 60px rgba(31,41,55,.12)` |
| `--shadow-glow` | `0 0 0 3px rgba(45,212,191,.16)` | `0 0 0 3px rgba(20,184,166,.14)` |

### Terminal + code (chỉ tồn tại ở Cute — luôn tối, cả hai biến thể)

| Token | Giá trị | Dùng ở |
|---|---|---|
| `--termBg` | `#1e2325` | Nền pane terminal (`WorkspaceTerminal.vue`, `.gterm`) |
| `--termBgHead` | `#252b2d` | Header thanh terminal/snippets rail |
| `--termText` | `#e4ecea` | Chữ terminal + chip code-block trên nền tối |
| `--termBorder` | `rgba(255,255,255,.08)` | Viền panel terminal/code |
| `--codeBg` | `#24292e` | Nền `.codeblock`/`.codeplain` (markdown code fence) |

`useMarkdown.ts` chọn theme Shiki `github-dark` khi `useTheme().isDark || useThemeFamily().isCute` — nghĩa là code block trong Cute **luôn tối** kể cả ở biến thể light của theme (đọc như "machine output" trên nền tài liệu trắng, chủ đích trong thiết kế).

### Radius scale (dùng chung, khai ở `prototype.css :root`, không phải riêng của Cute)

| Token | Giá trị |
|---|---|
| `--r-xs` | 6px |
| `--r-sm` | 8px |
| `--r-btn` | 10px |
| `--r-card` | 14px |
| `--r-panel` | 16px |
| `--r-pill` | 999px |

### Motion scale (dùng chung)

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--dur-fast` | 130ms | hover |
| `--dur` | 160ms | đổi trạng thái |
| `--dur-panel` | 190ms | mở overlay/panel |

Hai scale này được thêm **thuần cộng thêm** vào `prototype.css :root` — không rule nào của AWOG family đọc chúng trước đây, nên việc khai báo không đổi gì ở giao diện mặc định; chúng tồn tại để Cute (và theme tương lai) nói chung một ngôn ngữ thay vì tự bịa số riêng.

## Cơ chế scope + vì sao 1 file restyle được cả app

Mọi rule trong `theme-cute.css` viết dưới dạng `body[data-theme-family='cute'] <selector>`. ui-next dựng từ một tập class prototype dùng chung (`.ni .li .btn .iconbtn .chip .tile .step .smenu …`), và mọi component đọc màu qua `var(--token)` thay vì hex trực tiếp — nên định nghĩa lại token + restyle đúng tập class đó một lần là cả app (theo comment trong file: ~262 component) di chuyển theo, không cần fork từng component.

Phần tinh vi hơn: **specificity**. Style Vue `<style scoped>` biên dịch một selector `.x` thành `.x[data-v-hash]` — độ đặc trưng (0 id, 2 class/attribute, 0 type). Rule `body[data-theme-family='cute'] .x` biên dịch thành (0 id, 2 class/attribute, 1 type) — cùng bậc class nhưng hơn 1 bậc "type" nhờ selector `body`. CSS so khớp theo thứ tự từng bậc, nên rule theme **thắng mà không cần `!important`**, miễn nó nhắm đúng chuỗi class mà `scoped` style của component đang dùng. Đây là lý do session tabs / list rows / composer / terminal không cần fork riêng theo component — chỉ vài chỗ chạm `:deep()` (độ đặc trưng ngang nhau) mới cần `!important` tường minh (xem §12 trong file, phần code-block).

### Cái bẫy đã cắn một lần: hai biến thể mode phải LOẠI TRỪ NHAU

Khối token dark viết là `body:not(.light)[data-theme-family='cute']`, **không** phải `body[data-theme-family='cute']`. Bỏ `:not(.light)` là bug thật đã xảy ra:

| Selector | Specificity |
|---|---|
| `body.light[data-theme-family='cute']` (token light) | (0, 2, 1) |
| `body[data-theme-family='cute'][data-surface='flat']` (token dark theo depth) | (0, 2, 1) |

Bằng điểm ⇒ **thứ tự trong file quyết định**. Khối depth nằm sau khối light, nên ở **light mode** nó ghi đè `--bgPanel`/`--bgEl`/`--bgInput` bằng giá trị **dark**, trong khi `--text` vẫn là màu tối → panel tối + chữ tối, chữ gần như vô hình. Khối `body.light[...][data-surface='flat']` chỉ khai lại một phần token nên không cứu được phần còn lại.

Quy tắc: **token dark luôn `:not(.light)`**, token light luôn `.light`. Khi đó thứ tự file và việc khai token thiếu đều không thể rò qua mode khác — và khối light theo depth được phép chỉ khai phần khác biệt. Rule component thì giữ trung tính theo mode (chỉ đọc token), không gắn `.light`/`:not(.light)`.

Cùng cái bẫy này tồn tại trong `app-shell.css` cho family `awog`; ở đó nó được xử lý bằng cách khai **đủ** bộ token trong mỗi khối `body.light[data-surface=…]`. Cách `:not(.light)` an toàn hơn vì không phụ thuộc việc nhớ khai đủ.

## Danh sách đầy đủ nơi MARKUP rẽ nhánh theo theme (`useThemeFamily()`)

Chỉ 6 vị trí sau đọc `isCute`/`family` — mọi nơi khác là khác biệt CSS thuần, không có `v-if` theo theme:

| File | Rẽ nhánh gì |
|---|---|
| `components/shell/NavRail.vue` | **Chỉ** logo sidebar: `<Icon name="home">` → `<AwogMascot>`. Footer giữ nguyên hàng nút như family `awog` |
| `components/session/SessionWelcome.vue` | Icon hero đổi thành `<AwogMascot bob>`. Tiêu đề/phụ đề **giữ nguyên** class `swh`/`swsub` — thang chữ hero thuộc component, `theme-cute.css` chỉnh lại từ đó (đổi class sang `cempty-t` sẽ mất `font-size: 1.5em`) |
| `components/shell/TerminalSnippetsRail.vue` | Khi rỗng, render khối `.cempty` (mascot + tiêu đề + mô tả + CTA) thay vì hint trơn |
| `components/session/SessionDetail.vue` | Header: 4 action ít dùng (pop out / minimize / export / delete) gom vào một menu `…` thay vì bày 7 icon cùng lúc (§7 + §21); mount thêm `<SessionDoneFlash>` |
| `components/session/SessionDoneFlash.vue` | Toàn bộ component chỉ tồn tại cho Cute — chip "Xong!" + mascot `state="happy"` hiện ~1400ms khi một lượt chuyển sang `done` (§13) |
| `composables/useMarkdown.ts` | Chọn theme Shiki `github-dark` khi `isCute` (kể cả ở biến thể light của Cute) |

`components/session/workspace/WorkspaceTerminal.vue` cũng `import` composable này nhưng **không phải markup fork** — nó dùng `family` làm dependency của một `watch()` để biết lúc nào phải tính lại theme xterm (JS object truyền cho thư viện ngoài, không phải Vue template), vì bật/tắt Cute làm `--termBg`/`--termText` xuất hiện/biến mất.

> **Đã thử rồi BỎ — đừng thêm lại từ brief.** Brief §4 vẽ một "small profile card" ở đáy sidebar (mascot + tên + dòng phụ + pill `Pro`). Đã dựng và bỏ hẳn theo yêu cầu người dùng: không có nguồn dữ liệu nào cho subscription tier nên pill chỉ lặp lại provider, và hai dòng còn lại (tên account + thư mục workspace) đều đã có ở **status bar** — card chỉ chiếm chỗ trong rail mà không thêm thông tin. Footer sidebar vì vậy giống nhau ở cả hai family.

> **Cách kiểm lại danh sách này khi code đổi:** `rg -l "useThemeFamily|AwogMascot" apps/desktop/ui-next` — mọi file trả về phải có trong bảng trên. Fork markup là chi phí bảo trì, nên ADR 0072 cố ý giới hạn nó ở đây; thêm một vị trí mới thì cập nhật bảng.

## Quy tắc khi thêm component/surface mới

- **Chỉ dùng token, không hardcode hex.** Toàn bộ màu đi qua `var(--token)` — đúng nguyên tắc đã có ở [`.claude/rules/nuxt-vue.md`](../../.claude/rules/nuxt-vue.md), ADR 0072 chỉ mở rộng nó sang theme family thứ hai. Một hex cứng sẽ đúng ở một family và sai ở family kia mà không có lỗi runtime nào báo — chỉ lệch màu khi bật thử.
- **Radius luôn lấy từ scale** (`--r-xs|sm|btn|card|panel|pill`) — đừng viết `border-radius: 12px` tự do.
- **Token chỉ tồn tại ở Cute** (`--accentSoft`, `--accentHover`, `--termBg`, `--termBgHead`, `--termText`, `--termBorder`, `--codeBg`, `--lavender`) **phải có fallback** khi dùng ngoài chính `theme-cute.css` (trong `<style scoped>` component hoặc `app-shell.css`), vì chúng không được định nghĩa dưới family `awog`. Pattern đã dùng trong code: `background: var(--accentSoft, var(--accentDim))` (NavRail.vue) ở CSS, hoặc `cssVar('--termBg', cssVar('--bg', '#0d0d0d'))` (WorkspaceTerminal.vue) ở JS khi cần đọc giá trị tính toán.
- **Ngân sách mascot (90% chuyên nghiệp / 10% cute):** `AwogMascot.vue` chỉ được đặt ở — logo sidebar, empty state, và một success flash ngắn. Không đặt mascot trên mỗi row hay mỗi card; đó là lằn ranh biến công cụ dev thành app trẻ em (ghi rõ trong comment của chính component).
- **Đừng thêm markup fork mới** (`useThemeFamily()`/`isCute` trong template) trừ khi DOM **thật sự** phải khác — không phải để né việc viết đúng CSS cho cả hai family. 4 vị trí ở bảng trên là toàn bộ hiện có; thêm chỗ thứ 5 nên được cân nhắc lại thay vì làm theo phản xạ.
- **Không dùng chung spritesheet desktop-pet** (`components/pet/`) cho bất cứ nhu cầu "cute" mới nào — đó là asset lớn, nhiều sprite, do trạng thái agent sống điều khiển, khác hẳn mục đích brand-mark tĩnh của `AwogMascot`.

## Known gaps / chưa làm

- **`shadcn` vẫn là placeholder chưa implement** — tồn tại trong `ThemeFamily`/UI segmented control từ trước ADR 0072, chọn nó hiện tại rơi về đúng giao diện AWOG vì chưa có `theme-shadcn.css` nào.
- **Chưa xác nhận `nuxt.config.ts` đã nạp đúng `~/assets/css/theme-cute.css`** ở cuối mảng `css`. Nếu mảng đó vẫn liệt kê một tên file CSS khác (đã bị đổi tên/xoá) thay vì `theme-cute.css`, theme sẽ **không được nạp** dù store/composable/component đã đúng — kiểm tra trực quan trước khi coi feature là "đã ship" với người dùng.
- **Chuỗi mô tả i18n** cho setting Theme family (`settings.appearance.themeFamily.desc`, cả `en`/`vi`) vẫn còn nói "AWOG or shadcn slate" — chưa nhắc tới Cute. Không chặn chức năng, chỉ là copy lệch.
- **Chưa có visual regression / screenshot test** cho ma trận 2 family × 2 mode (dark/light) × 3 surface-depth.
- **`shadcn` khi được implement thật** nên đi theo đúng pattern D-3..D-5 của [ADR 0072](../decisions/0072-cute-theme-family.md) (1 file scoped theo attribute, markup fork tối thiểu) — chưa có kế hoạch cụ thể cho việc đó.

## Tham chiếu

- [ADR 0072 — Theme family thứ 2: "Cute"](../decisions/0072-cute-theme-family.md) — quyết định, phương án đã cân nhắc, trade-off
- [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md) — quy ước Tailwind + theme token
- [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md) — mục "Tailwind + theme"
- `apps/desktop/ui-next/assets/css/theme-cute.css` — nguồn sự thật cho mọi giá trị token ở trên
- `apps/desktop/ui-next/composables/useThemeFamily.ts`, `apps/desktop/ui-next/composables/useTheme.ts`, `apps/desktop/ui-next/composables/useAppearanceDom.ts`
- `apps/desktop/ui-next/components/common/AwogMascot.vue`
