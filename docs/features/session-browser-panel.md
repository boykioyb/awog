# Feature: Browser — trình duyệt của agent thành một view của Session

Tab **Browser** trong Workspace Panel hiển thị chính Chromium mà `browser_tool` đang lái, ngay cạnh transcript. Quyết định kiến trúc: [ADR 0086](../decisions/0086-embedded-browser-panel.md) (revisit window-model của [ADR 0043](../decisions/0043-browser-tool-embedded-chromium.md)).

Trước bản này, trình duyệt của agent **không có bề mặt nào để thấy**: cửa sổ ẩn mặc định, chỉ mở được từ tray, và trong transcript nó chỉ là một step một dòng. Kết quả đo trên máy thật: **0 lời gọi `browser_tool` trong toàn bộ 793 session** — công cụ chạy được nhưng không ai biết nó ở đó.

## Mở bằng cách nào

| Đường | Ở đâu |
|---|---|
| **Nút Browser ở status bar** | thanh dưới cùng, cạnh nút Files — một cú bấm, chỉ hiện khi có session đang mở |
| View picker của Session | nút Workspace ở header → chọn **Browser** |
| Nút `+` trong panel | thêm view vào panel đang mở |
| Tray → *Toggle browser window* | mở tab đang active ra **cửa sổ riêng** (popout) |

Tab được **mount lười và giữ mounted** như Terminal: chưa mở thì không tốn Chromium nào, mở rồi thì trang (và trạng thái đăng nhập) sống qua mọi lần đổi tab.

## Nhìn thấy gì

- **Tab strip** — mỗi tab của agent một chip, có spinner khi đang tải, `×` để đóng, `+` để mở tab mới. Strip cập nhật **theo từng lần agent điều hướng**, không cần refresh.
- **URL bar** — gõ URL để tự mở, `⏎` để đi; back/forward/reload; rồi nhóm hành động trên trang: 📌 ghim, copy URL, dịch phần bôi đen, trích phần bôi đen vào chat, chọn một phần tử để thêm vào chat. Nút đẩy tab ra cửa sổ riêng (⧉) nằm ở hàng tab, cùng nhóm với split-view · `⋮` · mở rộng · đóng.
- **Trang đã ghim** — dải chip dưới URL bar, chỉ hiện khi có pin. Bấm chip = mở tab mới trên trang đó; `×` để bỏ ghim; chip của trang đang xem được tô accent.
- **Copy URL** — copy **URL đang tải thật** (`activeTab.url`), không phải chuỗi trong ô input (ô đó là thứ người dùng đang gõ). Icon đổi thành ✓ khoảng 1,4 giây.
- **Khung trang** — chính trang web, tương tác trực tiếp bằng chuột/bàn phím.
- **Panel tự theo tab agent đang dùng.** Agent gọi `tab_new`/`tab_select` giữa lượt thì panel chuyển theo — đó là khác biệt giữa "xem agent duyệt web" và "nhìn một tab cũ".

## Chrome dùng chung cho panel và cửa sổ popout

Bố cục theo Claude, hai hàng: **hàng 1** = tab strip (`+` mở tab mới) bên trái, nhóm nút "cửa sổ" bên phải; **hàng 2** = `←` `→` `⟳` + ô URL + nhóm hành động trên trang. Cả hai hàng nằm trong [BrowserChrome.vue](../../apps/desktop/ui-next/components/browser/BrowserChrome.vue) và được **hai** bề mặt dùng lại:

| Bề mặt | Khung placeholder | Nhóm nút hàng 1 |
|---|---|---|
| view Browser của panel — [WorkspaceBrowser.vue](../../apps/desktop/ui-next/components/session/workspace/WorkspaceBrowser.vue) | một hộp trong panel | split-view (đổi mép dock) · `⋮` · popout · mở rộng panel · đóng view |
| cửa sổ popout — [pages/browser.vue](../../apps/desktop/ui-next/pages/browser.vue) | cả cửa sổ | `⋮` · đóng cửa sổ |

`useEmbeddedBrowser` sống ở **bề mặt**, không ở chrome: rect dán vào hộp placeholder của chính bề mặt đó, nên mọi luật của composable (view phải đang thật sự hiện trong document, `onDeactivated`/`onActivated`, một-chủ-một-view) vẫn đo trên đúng cái hộp mà người dùng đang nhìn. Cửa sổ popout **không cần kênh IPC mới**: `browser:attach|bounds|detach` lấy cửa sổ đích từ `event.sender`, nên trang tự nhận view vào rect của mình. Nó cũng mount `AppGlobalHosts` — không có nó thì `confirm()` của "Xoá dữ liệu duyệt web", toast đường dẫn ảnh chụp và popover dịch đều im lặng trong cửa sổ đó.

Ba nút "panel" (split-view / mở rộng / đóng) **không** đi qua props của panel — panel không truyền handler xuống view: chúng ghi thẳng vào `settings.workspacePanel` (dock + cỡ) và gọi `useWorkspacePanel().toggleView('Browser')`, cùng đường mà nút Browser ở status bar dùng, nên SessionDetail vẫn là nơi duy nhất sở hữu danh sách view đang mở. Hệ quả đã biết: đổi dock sang mép **đang có view khác active** thì Browser vào đó dưới dạng tab *không* active (chọn tab active là việc của panel).

## Mở rộng panel: theo chỗ thật, không theo hằng số

Ba lỗi cùng gốc "renderer tưởng mình biết, nhưng không đo" (sửa 2026-09-09):

**1. Nút mở rộng nghiền cột chat.** Nó nhảy thẳng lên `WP_MAX` (560 side / 600 bottom) bất kể cửa sổ rộng bao nhiêu. Đo ở row 680px: panel 560 ⇒ **chat còn 114px**, một dải card dẹt — người dùng đọc ra là "tràn, không fit màn hình". Nay trần là

```
min(WP_MAX, 60% của hộp, hộp − sàn chat)      sàn chat: 320px (side) · 220px (bottom)
```

| Row | Trước | Sau |
|---|---|---|
| 680 | panel 560 · chat **114** | panel 360 · chat 314 |
| 1180 | panel 560 · chat 614 | **không đổi** (560 · 614) |

**2. Trần phải REACTIVE — và observer không được tự kích lại.** Bản vá đầu của luật trên đọc DOM trong một `computed` — mà cỡ cửa sổ không phải dep reactive nào, nên kéo cửa sổ từ 680 lên 1180 rồi thì nút vẫn nghĩ panel đã mở hết cỡ (đo: panel 360 mà nút hiện "Trả bảng về cỡ cũ"). Nay `room` là `ref`, cập nhật bằng `ResizeObserver` đặt trên **chính hộp flex chứa panel** — hộp đó co lại vì nhiều đường hơn là `window.resize` (gập danh sách phiên, mở panel mép kia).

⚠ Và bản vá đó lại tự sinh lỗi thứ hai: callback gọi `disconnect()` rồi `observe()` **ngay trong chính nó**. `observe()` một element **luôn** phát callback lần đầu ⇒ nó tự gọi lại mình vô hạn, Chromium đổ `ResizeObserver loop completed with undelivered notifications` liên tục. Hai luật giữ cho nó không tái diễn: **đăng ký observer ở ngoài callback** (`watchBox`, chạy từ `onMounted` + `watch([viewportEl, dock])`, và bỏ qua nếu đang quan sát đúng element đó rồi), và **chỉ ghi `room` khi số thực sự đổi** (mỗi lần ghi là một lần đánh thức `expandTarget` + watcher clamp). Ghi cỡ panel không làm hộp đổi bề rộng — hộp do cha nó định — nên quan sát hộp không tạo vòng phản hồi. Đo sau khi vá: 4 lần kéo cửa sổ + 6 lần bấm mở rộng/thu ⇒ **0 warning**.

**3. Cửa sổ nhỏ lại thì panel phải nhỏ theo.** Chặn cú bấm mới là nửa việc: mở rộng ở màn 1700 rồi thu cửa sổ về 1200 thì panel vẫn 560 và chat lại còn 114 — cùng một cái nghiền, khác đường tới. Panel không tự co (`flex: 0 0 <size>`, cố ý — nó là cột có cỡ do người dùng đặt), nên chỗ duy nhất sửa được là **ghi lại cỡ** khi nó vượt trần. Có mất preference (kéo rộng 560 rồi thu cửa sổ là mất số đó), đổi lại là một layout còn dùng được; giữ một con số mà cột chat không đọc nổi thì không phải giữ gì cả.

## Hai lỗi giao tiếp renderer ↔ main (cùng sửa 2026-09-09)

**`attach` không được ném vì một `tabId` cũ.** `tabId` từ renderer là một **bản cache** — nó giữ danh sách từ event `changed` cuối cùng nó nhận, nên hoàn toàn có thể xin `tab_1` sau khi tab đó đã bị đóng (`Error invoking remote method 'browser:attach': no such browser tab: tab_1`). `this.tab(id)` ném là **đúng** cho mọi hành động chỉ định tab (đọc/điều hướng tab nào là ý muốn rõ ràng) nhưng **sai** cho `attach`: đây là yêu cầu **hình học** ("cho tôi một view vào hình chữ nhật này") và main là nguồn sự thật. Nay id lạ thì rơi về tab active (tạo mới nếu chưa có) và `TabInfo` trả về mang **id thật** để renderer tự sửa mình theo. Đo: `attachTo(host, 'tab_1', rect)` sau khi tab_1 bị đóng → không ném, trả `tab_2`, `shown: true`.

**Đóng cửa sổ popout thì trang phải về lại panel.** Main park view lại và phát `changed`, nhưng renderer không gọi `sync`: nhánh re-attach cũ chỉ chạy khi **tab active đổi**, mà ở đây nó không đổi — nên panel ngồi im với `holding = false` trong khi view đang rảnh. Nay `applyList` còn nhận lại view khi thấy `!shown && !shownElsewhere` (không ai giữ) và chỗ này đang là chủ hợp lệ. Đo: trong popout → `{shown:false, elsewhere:true}`; đóng popout → `{shown:false, elsewhere:false}` + 1 change event ⇒ đúng điều kiện.

## Menu `⋮`

| Món | Làm gì |
|---|---|
| **Lưu ảnh chụp trang** | `browser.saveScreenshot(root)` → toast đường dẫn (rút về tương đối với workspace) và bấm toast để mở trong Finder. Không giải được project ⇒ **tắt** kèm hint "Chưa có thư mục dự án" — cửa sổ popout không có session nào để suy ra root. |
| **Nhập cookie** | mở `WorkspaceBrowserImport` (trước bản này là một nút riêng trên thanh công cụ) |
| **Quản lý site được phép** | [BrowserSitesModal.vue](../../apps/desktop/ui-next/components/browser/BrowserSitesModal.vue) — chọn `off` / `allowlist` (`AppSelect`, không `<select>` native) + danh sách host thêm/xoá, đọc `browser.sites()` và **ghi ngay** mỗi lần đổi qua `browser.setSites()` (không có nút Save: một chính sách bảo mật đang hiện trên màn hình mà chưa xuống đĩa là thứ dễ đọc sai nhất ở bề mặt này) |
| **Mở link trong trình duyệt của app** | công tắc có ✓, nối thẳng vào `useLinkOpen()` mode: tick = `'app'`, bỏ tick = `'ask'` — không có state thứ hai |
| **Xoá dữ liệu duyệt web** | `browser.clearData()` sau `useConfirm()` (destructive) |

Cố ý **không** có: "Open file", "Disable auto verify", "Persist sessions".

## Dịch phần bôi đen trong trang

Nút dịch gọi `browser.selection()` — text người dùng bôi đen **trong trang**, không phải selection của renderer — rồi mở đúng popover selection-to-translate dùng chung (`useSelectionTranslate.open(text, rect, project)`). Không có bề mặt dịch thứ hai.

Nút **tắt khi không có text bôi đen**, và biết được điều đó phải trả giá: selection nằm trong một `webContents` khác nên không có event nào báo về. `useEmbeddedBrowser` vì thế **poll** `selection()` 1,2 s/lần và **chỉ khi instance đang giữ view** (panel đang park thì chẳng có gì để hỏi); một lần lỗi là tắt poll hẳn — lý do `selection()` reject là cấu trúc (bản main chưa có phần E, hoặc không có tab), không phải nhất thời.

⚠ **Kết quả dịch KHÔNG dùng popover nổi** (sửa 2026-09-09). Bản đầu gọi popover selection-to-translate dùng chung và thêm `.sttpop` vào `OCCLUDING` — đúng luật, nhưng sai người dùng: popover hiện lên thì **trang bị gỡ khỏi màn hình**, thay bằng dòng "Tạm ẩn khi có hộp thoại mở", đúng lúc người ta cần đối chiếu bản dịch VỚI trang.

Nay `useSelectionTranslate` mang thêm `surface: 'dom' | 'browser'`:

| Nguồn | Render ở đâu |
|---|---|
| `'dom'` — bôi đen trong DOM của app (transcript, preview) | popover nổi, neo vào selection (như cũ) |
| `'browser'` — bôi đen **trong trang** của trình duyệt nhúng | [BrowserTranslateStrip.vue](../../apps/desktop/ui-next/components/browser/BrowserTranslateStrip.vue) — một dải trong **chrome**, tức vùng DOM ngoài rect của view ⇒ **không ai phải ẩn đi** |

Chỉ CHỖ RENDER khác nhau: cả hai dùng chung state, cache theo `(lang, text)`, RPC `text.translate` và bộ chọn VI/EN/JA của cùng một composable. Strip in text thuần (không render markdown): nó cao 3–4 dòng trong thanh công cụ, và nội dung là văn bản từ một trang web (L1) — càng ít đường biến nó thành HTML càng tốt.

`.sttpop` **vẫn phải** nằm trong `OCCLUDING`: bôi đen trong transcript khi panel Browser đang mở thì popover đó vẫn có thể chồng lên rect của view.

## Ba trạng thái thay cho trang

| Trạng thái | Khi nào | Hiện gì |
|---|---|---|
| **Không khả dụng** | chạy trong browser-dev (`pnpm dev` ở :3031), không có shell Electron | "Trình duyệt nhúng chỉ có trong app desktop." |
| **Đang ở chỗ khác** | tab đang hiển thị ở dock kia hoặc ở popout | placeholder + nút **Hiện ở đây** |
| **Tạm ẩn** | có modal/menu/lightbox đang mở | "Tạm ẩn khi có hộp thoại mở." |

Hai trạng thái sau là hệ quả trực tiếp của việc trang là một **view native**, không phải element: xem phần dưới.

## Vì sao có luật "tạm ẩn"

Trang không phải `<iframe>` — nó là `WebContentsView` do Electron main sở hữu, **vẽ trên toàn bộ DOM**. Không CSS nào đặt được modal, menu hay toast lên trước nó; z-index band của app ([reference](../coding/nuxt-frontend.md)) vô hiệu với nó. Nên `useEmbeddedBrowser` gỡ view khỏi màn hình khi thấy `.ovl.on, .lbox, .smenu, .pop, .sttpop` trong DOM (MutationObserver trên `document.body`) — hai quy ước markup mà app này vốn đã dùng cho "có thứ gì đang nổi trên trang". Menu cũng tính: chính menu dock và menu `+` của panel mở ngay trên thân panel.

Cái giá: mở một popover bất kỳ cũng làm trang biến mất một nhịp rồi hiện lại.

## ⚠ Invariant: view phải bị gỡ khi khung KHÔNG còn trên màn hình

Đây là lỗi đã xảy ra thật (2026-09-09): mở Browser trong một session rồi đổi sang project/session khác thì **trang web của agent nằm đè lên UI mới**.

Nguyên nhân: app này giữ cả hai lớp KeepAlive — `<NuxtPage keepalive>` (đổi trang) và `<KeepAlive :max="5">` quanh `SessionDetail` ([pages/sessions.vue](../../apps/desktop/ui-next/pages/sessions.vue), file đó ghi thẳng *"onUnmounted never fires on navigation"*). Bản đầu của `useEmbeddedBrowser` chỉ nghe `onMounted`/`onUnmounted`, nên rời trang chỉ **deactivate** chứ không unmount ⇒ không có ai gọi `detach()`. Mà view native **không phải element**: không CSS nào, không `v-show` nào, không Vue nào gỡ nó — nó cứ vẽ tiếp ở toạ độ cũ.

Hai luật giữ cho việc đó không tái diễn:

1. **Điều kiện là "khung có đang thật sự hiện trong document?", không phải "component còn mounted?".** `onScreen(el)` kiểm `el.isConnected` + hộp ≥ 8px. Một mệnh đề phủ mọi đường ẩn cùng lúc: KeepAlive (DOM bị đưa ra khỏi document), ancestor `display:none`, panel bị thu, [minimize dock](minimize-dock.md).
2. **`onDeactivated` gỡ ngay, `onActivated` gắn lại.** Không chờ `sync()` — deactivation không phải trigger của nó, và một resize để cứu có thể không bao giờ tới.

Và một cạm bẫy thứ tự: Vue có thể **activate instance mới trước khi deactivate instance cũ**, trong khi `detachFrom(window)` ở main park **mọi** tab của cửa sổ đó ⇒ cú detach muộn của instance vừa mất quyền sẽ gỡ view của instance vừa nhận. Nên **chỉ chủ sở hữu hiện tại được phép detach** (`detachNow` kiểm `owner === id`); instance đã mất quyền chỉ nhả cờ local, còn lại để watcher `isOwner` của chủ mới lo.

## Panel hẹp: thanh công cụ xuống dòng, không bị bóp

Panel kéo được xuống tới **240px** (`WP_SIDE.min` trong SessionDetail). Ở đó, một hàng công cụ đơn không tràn ra ngoài — nó **bóp ô URL còn 41px**, tức một ô nhập không hiển thị được gì (đo được). Nên **hàng 2** được chia thành **hai nhóm cố định + một ô co giãn**, và cho phép `flex-wrap`:

`nav (74px) + basis + actions (126px) + gap (8) + padding (16) ≤ bề rộng panel`

`flex: 1 1 96px` trên ô URL biến bất đẳng thức đó thành ngưỡng xuống dòng — nên **basis là số học, không phải khẩu vị**. Nhóm hành động giờ nặng **126px** (5 nút: ghim · copy · dịch · trích · chọn phần tử) thay cho 96px của bản 4 nút, nên basis phải tụt 110 → 96 để panel mặc định 322px **vẫn còn một dòng**: 74 + 96 + 126 + 8 + 16 = **320**.

| Bề rộng panel | Bố cục hàng 2 | Ô URL | Cao hàng 2 |
|---|---|---|---|
| 560 (max) · 420 · **322 (mặc định)** | **một dòng** | 336 · 196 · 98px | 40px |
| 300 · **240 (min)** | hai dòng (5 nút hành động xuống dòng dưới) | 206 · 146px | 66px |

Ngưỡng đo được đúng bằng số học: **320px = một dòng, 319px = hai dòng**. Ở mọi bề rộng: `scrollWidth − clientWidth = 0` trên **cả hai** hàng (không tràn) và **cả 13 nút đều hiển thị** — hàng 1: 5 nút cửa sổ, hàng 2: 3 nút điều hướng + 5 nút hành động.

Hàng 1 **không** xuống dòng: tab strip là phần co được (`flex: 1 1 auto` + `overflow-x: auto`) nên panel hẹp cuộn tab chứ không đẩy nút; cái giá là +11px chiều cao khi thanh cuộn ngang xuất hiện (≤ 318px, đo trong Chromium headless — macOS dùng overlay scrollbar nên thực tế thường không mất chỗ).

⚠ **Thêm nút vào hàng 2 ⇒ phải tính lại con số 126**, và sửa cả comment ở `.bch-url` trong BrowserChrome.vue lẫn bảng này.

⚠ **Cửa sổ hẹp hơn 1040px thì KHÔNG có panel nào cả** — `prototype.css:640` có `@media(max-width:1040px){.wpanel,.rszwp{display:none!important}}`, áp cho mọi view (Diff/Files/Terminal…), không riêng Browser. Chip "Trình duyệt" ở status bar vẫn sáng trong khi không thấy gì. Đây là hành vi có sẵn từ prototype, không phải do tính năng này; nhưng nó tương tác đúng với luật ở trên: `display:none` ⇒ `onScreen` false ⇒ view **được gỡ** (đo: `detach` bắn khi thu cửa sổ qua ngưỡng), nên không để lại lớp phủ chết.

## Ghim trang ≠ ghim tab

Tab trong trình duyệt này **thuộc về agent**: nó mở giữa lượt, đóng khi xong, và `browser.close()` xoá sạch lúc thoát app. Nên "giữ trang này lại" **không thể** là "giữ tab này" — một pin phải sống lâu hơn mọi tab, và lâu hơn cả lần khởi động lại.

Vì thế pin là một **danh sách `{url, title}` persist** ([useBrowserPins.ts](../../apps/desktop/ui-next/composables/useBrowserPins.ts), `localStorage` key `awog.browserPins`, cap 12, mới nhất trước, vượt cap thì cái cũ nhất rơi ra chứ không từ chối pin), và bấm chip là **mở tab MỚI** trên URL đó. So sánh URL bỏ dấu `/` cuối, vì `wc.getURL()` chuẩn hoá `https://x.com` thành `https://x.com/` còn URL gõ tay thì không — thiếu bước này thì cùng một trang ghim được hai lần và nút toggle không tìm thấy bản cũ.

## Vì sao chỉ một dock hiển thị được

Một `webContents` không thể ở hai hình chữ nhật. Panel có thể dock 2 chỗ cùng lúc (phải + dưới), nên `useEmbeddedBrowser` có trọng tài cấp module: instance đầu tiên giữ view, instance còn lại vẽ "đang hiển thị ở chỗ khác" + nút giành lại. Cùng mô hình hand-off với [session popout](session-popout-window.md).

## Bảo mật

Kế thừa toàn bộ hàng rào của [browser-tool.md](browser-tool.md) — SSRF 3 sự kiện (`will-navigate`/`will-redirect`/`will-frame-navigate`), chặn popup/download/permission request, partition riêng — cộng bốn điểm của riêng bề mặt này:

- **URL người dùng gõ đi qua ĐÚNG cổng của agent.** `openFromUser` gọi `hostBlocked` y như `navigate`; loopback/IP private bị chặn ở cả panel. Không có cửa sau quanh invariant #7.
- **Renderer không addressing được cửa sổ khác.** `browser:attach|bounds|detach` lấy cửa sổ đích từ `event.sender`; không có window id nào đi qua IPC (invariant #4).
- **Rect là L1** → `clampRect` ghim mọi field thành số nguyên trong `±10000` trước khi xuống tầng native.
- **Nội dung trang vẫn chỉ có một cửa vào app.** Bề mặt IPC mới chỉ có điều hướng + hình học. Mọi hành động ĐỌC trang (snapshot/extract/console/network/screenshot) vẫn đi đường sidecar, nơi có hàng rào nonce + `redactString`.

Từ 2026-09-09 tab này còn có nút ⬇ **nhập cả profile browser thật** (Chrome/Edge/Brave/Arc/Vivaldi/Chromium) vào jar của agent — cookie + Local Storage + IndexedDB, không bao giờ mật khẩu đã lưu: [browser-profile-import.md](browser-profile-import.md).

⚠ **Thay đổi thế trận bảo mật, cố ý:** người dùng gõ/bấm được trong tab này, nên **đăng nhập của người dùng rơi vào `persist:awog-browser` — partition mà agent đọc được**. Đó vừa là điều làm nó hữu ích (agent đọc được trang sau đăng nhập), vừa là điều 0043 chưa có (khi đó chỉ agent chạm partition ấy). Ai không muốn thế thì đừng đăng nhập trong tab này. Hạng mục **đầu tiên** của lần infosec re-audit.

## Giới hạn đã biết

- `viewport` khi tab đang nhúng trong panel chỉ emulate qua CDP; rect thật thuộc layout của panel nên không đổi theo. Popout và tab đang park thì resize thật được.
- Model **chưa** tự mở được panel; chỉ người dùng mở. Đang cân nhắc một action `show` (ADR 0086, việc cần làm tiếp).
- Trang bị gỡ khỏi màn hình một nhịp mỗi lần có popover mở.
- **Cửa sổ popout không suy ra được workspace root** (nó là renderer riêng, không có session nào đang active) ⇒ "Lưu ảnh chụp trang" tắt ở đó. Muốn bật thì main phải truyền project vào URL của cửa sổ.
- Đổi mép dock từ chrome không kéo theo "làm tab active" ở mép đích khi mép đó đang có view khác — chọn tab active là việc của panel.

## File chạm

| File | Thay đổi |
|---|---|
| [electron/src/browser.ts](../../apps/desktop/electron/src/browser.ts) | tab = `WebContentsView`; `holder` vô hình + `park`/`ensurePainted`; `attachTo`/`setViewBounds`/`detachFrom`; `openFromUser`/`goBack`/`goForward`/`reload`; popout thay cho show/hide theo cửa sổ-mỗi-tab; `listTabs(forWindow)` + `info()` |
| [electron/src/ipc.ts](../../apps/desktop/electron/src/ipc.ts) | **Mới** `registerBrowserViewIpc()` — 12 kênh `browser:*` + broadcast `browser:changed` theo từng cửa sổ |
| [electron/src/preload.ts](../../apps/desktop/electron/src/preload.ts) | `window.awog.browser.*` |
| [ui-next/composables/useEmbeddedBrowser.ts](../../apps/desktop/ui-next/composables/useEmbeddedBrowser.ts) | **Mới** — glue rect ↔ view, luật che (`.sttpop` trong `OCCLUDING`), trọng tài một-chủ, follow tab của agent, poll `selectionText`, action cho chrome |
| [ui-next/components/browser/BrowserChrome.vue](../../apps/desktop/ui-next/components/browser/BrowserChrome.vue) | **Mới** — chrome 2 hàng dùng chung (tab strip · nhóm nút cửa sổ · nav + URL + hành động), menu `⋮`, ghim/copy, dịch, trang → chat |
| [ui-next/components/browser/BrowserSitesModal.vue](../../apps/desktop/ui-next/components/browser/BrowserSitesModal.vue) | **Mới** — `⋮` → quản lý site được phép (`off` / `allowlist` + host list) |
| [ui-next/pages/browser.vue](../../apps/desktop/ui-next/pages/browser.vue) | **Mới** — route của cửa sổ popout: BrowserChrome + placeholder + `AppGlobalHosts` |
| [ui-next/components/session/workspace/WorkspaceBrowser.vue](../../apps/desktop/ui-next/components/session/workspace/WorkspaceBrowser.vue) | **Mới** — BrowserChrome + placeholder box + 3 trạng thái + chỗ nối vào panel (dock · mở rộng · đóng view) |
| [ui-next/components/session/SessionWorkspacePanel.vue](../../apps/desktop/ui-next/components/session/SessionWorkspacePanel.vue) | mount lười + giữ mounted, `FLUSH_TABS`/`HANDLED_TABS` |
| [ui-next/components/session/SessionDetail.vue](../../apps/desktop/ui-next/components/session/SessionDetail.vue) | `ALL_VIEWS` thêm `Browser` |
| [ui-next/components/shell/AppStatusBar.vue](../../apps/desktop/ui-next/components/shell/AppStatusBar.vue) | nút Browser một-cú-bấm |
| [ui-next/composables/useSessionsData.ts](../../apps/desktop/ui-next/composables/useSessionsData.ts) | `WPVIEWS` thêm `['Browser', 'globe']` |
| [ui-next/types/awog-bridge.d.ts](../../apps/desktop/ui-next/types/awog-bridge.d.ts) | `AwogBrowserRect` / `AwogBrowserTab` / `AwogBrowserTabList` |
| i18n `sessions.json` + `statusbar.json` (en/vi) | 11 + 1 key |
| i18n `browser.json` (en/vi) | **Mới** — 28 key: menu `⋮`, hộp thoại site, dịch/trích/chọn phần tử, toast |
