# 0072 — Theme family thứ 2: "Cute" (mint/off-white), opt-in qua hook có sẵn

- **Trạng thái:** Accepted (2026-08-19)
- **Ngày:** 2026-08-19
- **Người quyết định:** Tech Lead (theo yêu cầu user)

## Bối cảnh

ui-next chỉ có **một** ngôn ngữ hình ảnh: bảng token trong `prototype.css` đã được retune từ bản gốc của prototype sang **native macOS system-gray** (elevated grays, hairline translucent thay vì border cứng, Apple neutral label grays) — một quyết định UI có chủ đích trước đó (xem `.claude/rules/nuxt-vue.md` mục Tailwind + theme, và ghi chú "user reject nền xám đặc"). Yêu cầu mới: một diện mạo **sạch — cute — premium** khác hẳn, không phải biến thể của bảng system-gray đó.

Phương án rẻ nhất — sửa thẳng giá trị token trong `:root` / `body.light` của `prototype.css` — đã bị loại ngay từ đầu: nó đổi giao diện cho **mọi** user không xin phép, không có đường lùi, và phá vỡ quyết định "system-gray" đã chốt trước đó thay vì cộng thêm lựa chọn.

May mắn là hook cho một theme *family* thứ hai đã tồn tại nhưng **ngủ yên**: `settings.appearance.themeFamily: 'awog' | 'shadcn'` được `useAppearanceDom.ts` áp vào DOM thành `body[data-theme-family]` từ trước, nhưng chưa có dòng CSS nào đọc thuộc tính đó — `'shadcn'` chỉ là placeholder chưa implement. Đây là điểm khởi đầu của quyết định này.

## Quyết định

Thêm giá trị thứ ba `'cute'` vào `ThemeFamily`, và dựng toàn bộ diện mạo mới **cưỡi lên** hook `body[data-theme-family]` sẵn có thay vì sửa token mặc định.

| # | Mảnh | Quyết định |
|---|---|---|
| **D-1** | Kiểu dữ liệu | `stores/settings.ts`: `ThemeFamily = 'awog' \| 'shadcn' \| 'cute'`. Default **giữ nguyên** `'awog'` — không ai bị đổi giao diện khi không làm gì. |
| **D-2** | UI chọn | `SettingsAppearance.vue`: segmented control 3 nút `AWOG \| Cute \| shadcn` (Settings → Appearance → Theme), map 2 chiều label ↔ value; `store.updateAppearance({ themeFamily })` + `applyThemeFamily()` áp ngay, không cần reload. |
| **D-3** | Cơ chế style | **Một file** `assets/css/theme-cute.css`, nạp ở cuối mảng `css` trong `nuxt.config.ts` (sau `prototype.css` + `app-shell.css`). **Mọi** rule trong file được scope dưới `body[data-theme-family='cute']` — không rule nào ở ngoài scope đó, nên tắt theme là quay lại y hệt giao diện cũ. |
| **D-4** | Vì sao 1 file đủ | ui-next dựng từ một tập class prototype dùng chung (`.ni .li .btn .iconbtn .chip .tile .step .smenu …`) và mọi component đọc màu qua `var(--token)`. Định nghĩa lại token + restyle đúng tập class đó một lần là cả app di chuyển theo. Scope theo attribute còn có lợi thế **specificity**: một selector Vue `scoped` biên dịch thành `.x[data-v-hash]` (đặc trưng 0,2,0); `body[data-theme-family='cute'] .x` biên dịch thành (0,2,1) — cùng bậc class, hơn 1 bậc type nhờ `body` — nên theme thắng **không cần `!important`**, miễn là nó nhắm đúng chuỗi class mà style `scoped` của component dùng. |
| **D-5** | Markup fork | Chỉ ở nơi theme đổi **DOM thật**, qua composable mới `useThemeFamily() → { family, isCute }`: mascot ở logo sidebar + profile card footer (`NavRail.vue`), empty state cute (`SessionWelcome.vue`, `TerminalSnippetsRail.vue`), chọn theme Shiki `github-dark` khi cute (`useMarkdown.ts`). Mọi nơi khác **bắt buộc** là khác biệt CSS thuần — không thêm `v-if` theo family để né việc phải viết CSS đúng chỗ. |
| **D-6** | Mascot | Component mới `components/common/AwogMascot.vue` — SVG line-drawn vẽ tay, ăn `currentColor`, không phải raster. Cố ý **không dùng chung** spritesheet desktop-pet (`components/pet/`): pet là asset lớn, user chọn giữa nhiều sprite, do trạng thái agent sống điều khiển; mascot là brand mark tĩnh, nhỏ, một hình duy nhất. Ngân sách xuất hiện: 90% chuyên nghiệp / 10% cute — chỉ ở logo, empty state, và một success flash, không ở đâu khác. |
| **D-7** | Token dùng chung | 3 scale mới thêm vào `prototype.css :root` — **thuần cộng thêm, không rule nào cũ đọc chúng nên giao diện AWOG không đổi gì**: radius 5 bậc (`--r-xs|sm|btn|card|panel|pill`), motion 3 bậc (`--dur-fast|dur|dur-panel`), `--shadow-glow`. Cute theme dùng scale này; theme tương lai (kể cả khi `shadcn` được implement) nói cùng một ngôn ngữ thay vì tự bịa số riêng. |
| **D-8** | Accent người dùng chọn | `useTheme.applyAccent()` giờ cũng pin `--accentSoft` (fill pastel đặc cho nav/tab active) và `--accentHover` (hover của CTA) làm chuỗi `color-mix()` sống. AWOG family không đọc 2 token này nên việc pin là **vô hại/inert** ở đó; Cute family đọc chúng nên accent tự chọn của user vẫn nhất quán ở theme mới thay vì rơi về mint mặc định. |
| **D-9** | Terminal + code block | Cố ý **giữ tối** ở Cute dù phần còn lại sáng màu (đọc dễ hơn + đọc như "machine output" trên nền tài liệu trắng). Cơ chế là **token có fallback**, không phải rẽ nhánh JS theo family: `--termBg/--termBgHead/--termText/--termBorder/--codeBg` chỉ tồn tại trong `theme-cute.css`; `WorkspaceTerminal.vue` đọc `cssVar('--termBg', cssVar('--bg', …))` và `useMarkdown.ts` chọn theme Shiki `isDark \|\| isCute ? github-dark : github-light` — dưới AWOG family các biến đó rỗng nên hành vi **byte-identical** với trước khi có ADR này. |

## Phương án đã cân nhắc

- **Sửa giá trị token tại chỗ trong `prototype.css`** — bị loại: đổi giao diện cho toàn bộ user không hỏi, không có đường lùi, và ghi đè lên quyết định "system-gray" đã chốt trước đó thay vì cộng thêm lựa chọn bên cạnh nó.
- **Nuxt layer / hệ design-system riêng cho theme thứ 2** — bị loại: AWOG chỉ có một app UI (`ui-next`), không đa-tenant nên không có nhu cầu thật cho khái niệm layer; thêm một tầng build mới chỉ để đổi *màu và bo góc* là over-engineering, vi phạm YAGNI.
- **Prop `theme` trên từng component, tự branch class/style bên trong** — bị loại: ui-next có ~262 component theo cùng một tập class dùng chung; buộc mỗi component tự biết về theme phá chính lợi thế đó, nhân bản effort mỗi khi thêm theme (kể cả `shadcn` sau này), và vi phạm DRY ở quy mô lớn.

Chọn D-1..D-9 vì đó chính là cách khai thác hook đã tồn tại: rẻ nhất, dễ đảo ngược nhất (xoá 1 file + đổi 1 giá trị default là quay lại nguyên trạng), và không đụng tới bất kỳ component nào ngoài 4 chỗ thật sự cần đổi markup.

## Hệ quả

- **Tích cực:**
  - Bật/tắt tức thời qua Settings, không cần rebuild; quay lại giao diện AWOG mặc định = đổi một giá trị.
  - Một file `theme-cute.css` restyle được gần toàn bộ app nhờ tập class dùng chung + biến `var(--token)` — không phải sửa từng component.
  - Cơ chế specificity (D-4) cho phép theme thắng style `scoped` của component **mà không cần `!important`** ở tuyệt đại đa số rule.
  - Terminal/code block giữ tối bằng token-có-fallback (D-9) — không thêm nhánh `if (theme === 'cute')` rải rác trong logic runtime.
  - Scale token dùng chung (D-7) là hạ tầng sẵn có cho theme thứ ba, kể cả khi `shadcn` (đã có placeholder từ trước) được implement thật.

- **Tiêu cực / Trade-off:**
  - Có **hai** diện mạo phải giữ đồng bộ: một class prototype mới thêm vào app phải được nghĩ tới ở cả hai family nếu muốn hiển thị đúng ở Cute — không có gì tự động nhắc developer việc này ngoài kỷ luật "token-only, không hardcode hex" (ghi trong [spec](../features/theme-cute.md)).
  - Đặc tính "attribute selector thắng specificity của `scoped` style" (D-4) là lợi thế ở đây nhưng cũng là một bất ngờ cho người đọc code sau: một style khai trong `<style scoped>` của component **không còn chắc thắng** nếu Cute theme định nghĩa cùng chuỗi class. Cần nêu rõ trong coding doc để tránh debug nhầm.
  - Markup fork qua `useThemeFamily()` là chi phí bảo trì tách biệt khỏi CSS thuần. Cố ý giới hạn ở đúng những nơi DOM thật sự khác nhau (D-5) — mở rộng thêm chỗ fork mới cần cân nhắc lại, không phải phản xạ mặc định khi làm feature mới cho Cute.
  - Giá trị `shadcn` trong `ThemeFamily`/UI vẫn là **placeholder chưa implement** — chọn nó hiện rơi về đúng giao diện AWOG mặc định vì chưa tồn tại `theme-shadcn.css` nào. Đây là nợ có từ trước ADR này (không phải ADR này tạo ra), nhưng ADR này xác nhận lại: khi implement, nó nên đi theo đúng pattern D-3..D-5, không phải cách khác.

- **Việc cần làm tiếp:**
  - **Xác nhận `nuxt.config.ts` nạp đúng `~/assets/css/theme-cute.css`** ở cuối mảng `css` (sau `app-shell.css`) — tại thời điểm viết ADR này, việc landing file đang diễn ra song song với vài agent khác; nếu mảng `css` còn trỏ tới một tên file cũ đã đổi tên, theme sẽ không được nạp dù mọi phần còn lại (store/composable/component) đã đúng.
  - QA thị giác: cả hai family × cả hai mode (dark/light) × ba mức surface-depth, trước khi công bố "đã ship" trong changelog người dùng.
  - Cân nhắc thêm một bước lint/CI grep hex-trong-`.vue` mới nếu hardcode màu lặp lại thành vấn đề thật trong review (chưa làm ngay — YAGNI cho tới khi có bằng chứng).

## Tham chiếu

- [Feature doc — Theme Cute](../features/theme-cute.md)
- [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md) — quy ước theme token / Tailwind
- [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md) — mục "Tailwind + theme" (bắt buộc qua `useTheme()`, không hardcode hex) mà ADR này mở rộng sang theme family thứ hai
- [ADR 0070](./0070-share-claude-home-for-config.md), [ADR 0071](./0071-senior-engineer-prompt-core.md) — hai ADR gần nhất, tham chiếu để khớp văn phong
