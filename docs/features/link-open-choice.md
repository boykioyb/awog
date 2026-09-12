# Feature: Bấm link → chọn mở trong app hay mở ra ngoài

Bấm một link web trong AWOG hiện popover ngay tại chỗ bấm: **Mở trong AWOG** (tab của [trình duyệt nhúng](session-browser-panel.md)) hay **Mở bằng browser của tôi**. Quyết định: [ADR 0086](../decisions/0086-embedded-browser-panel.md) phần C.

Trước đó mọi link chỉ có một đích nên app không cần code: `<a href>` / `target="_blank"` bị `will-navigate` / `setWindowOpenHandler` ở [window.ts](../../apps/desktop/electron/src/window.ts) bắt rồi `shell.openExternal`. Từ khi có trình duyệt nhúng thì có hai đích, và lựa chọn phải xảy ra ở **renderer** — main không vẽ được popover.

## Hành vi

| Thao tác | Kết quả |
|---|---|
| Bấm chuột trái vào link web | popover 2 lựa chọn, neo tại con trỏ |
| **⌘ / Ctrl / Shift-click** | ra browser ngoài **ngay**, không hỏi |
| `Esc` hoặc bấm ra ngoài | huỷ, không mở gì, **không** ghi nhớ gì |
| Tick **Luôn dùng cách này** rồi chọn | ghi mode, lần sau không hỏi nữa |
| Link không phải http(s) (`mailto:`…) | ra ngoài luôn, không hỏi |

**Mặc định `ask`.** Đổi ở **Settings → Workspace → Mở link**: *Hỏi mỗi lần* · *Trình duyệt của AWOG* · *Browser của tôi*. Hàng Settings này là **đường về** cho ai đã tick "luôn dùng cách này".

**Mở trong app luôn tạo tab MỚI** — agent có thể đang giữa lượt trên tab active, chiếm tab đó là làm hỏng việc đang chạy. Đang ở trong session thì view Browser của panel tự mở (và nó tự theo tab mới); không có session thì mở cửa sổ popout.

**Mở khung TRƯỚC, tải sau** (sửa 2026-09-09). Bản đầu `await api.newTab(url)` rồi mới mở panel, mà `newTab` ở main await `loadURL` ⇒ bấm một link tới PR GitHub là UI đứng vài giây rồi trình duyệt mới hiện. `newTab` nay nhận `waitForLoad`:

| Ai gọi | `wait` | Trả về khi | Đo với `example.com` |
|---|---|---|---|
| `browser_tool` (model) | `true` (mặc định) | trang tải xong — bước sau của agent là `snapshot`/`extract`, chụp trang chưa tải xong thì trả rác | **208 ms** |
| người dùng bấm link · nút `+` · chip ghim | `false` | tab đã tạo + điều hướng đã bắt đầu | **2 ms** |

Nhưng giảm độ trễ của `newTab` **chưa đủ**: bản vá đầu vẫn `await` lời gọi đó rồi mới mở khung, nên khung vẫn phải chờ một vòng IPC (và chờ cả bản main cũ nếu người dùng chưa khởi động lại). Thứ tự đúng là **mở khung trước, tạo tab sau**:

| Đường | Thứ tự | Vì sao |
|---|---|---|
| trong session (thường gặp) | `toggleView('Browser')` **rồi** bắn `newTab` không chờ | mở view là việc thuần renderer nên xảy ra ngay trong cú bấm; đo với `newTab` cố tình chậm 3000ms ⇒ khung có sau **17 ms** |
| không có session | `newTab` **rồi** `popout()` | ngược lại, vì `popout()` gọi `this.tab()` mà hàm đó **tạo một tab trắng** nếu chưa có tab nào — bắn song song sẽ để lại tab trắng và popout hiện đúng cái đó. Chi phí đường này bị việc dựng cửa sổ + nạp route lấn át rồi |

Hệ quả phụ đáng giá: vì khung không còn phụ thuộc lời gọi IPC nào, đường trong-session **hoạt động ngay cả khi tiến trình main còn là bản cũ** (chưa `pnpm dev` lại).

Guard host vẫn chạy **đồng bộ trước khi trả về** ở cả hai chế độ, nên URL bị chặn vẫn ném ngay (`cannot open http://127.0.0.1:9/x: private/loopback IP …`) — và giờ nó hiện thành toast `link.openFailed` thay vì im lặng: người dùng vừa bấm "mở trong app", im lặng thì họ tưởng app treo.

## Neo popover: theo điểm bấm CUỐI, không theo event

Popover phải hiện ngay đầu ngón tay, nhưng `openLink()` được gọi từ **hai** loại chỗ và chỉ một loại có `MouseEvent`:

| Người gọi | Có event? | Toạ độ |
|---|---|---|
| listener capture trên `<a>` | có | `clientX/Y` của cú bấm |
| **13 call site mở link bằng lệnh** (bảng dưới) | **không** | không có gì |

Bản đầu rơi về `{x: 0, y: 0}` khi thiếu event ⇒ bấm "Open in GitHub" thì popover nhảy về **góc trên trái màn hình** (lỗi thật 2026-09-10). Và một cái bẫy thứ hai: `el.click()` gọi từ code sinh `MouseEvent` **có** `clientX/Y` nhưng cả hai bằng **0** — nghĩa là "không có toạ độ", không phải "bấm ở góc". Nên luật là:

1. một listener `pointerdown` pha capture trên `document` ghi lại `lastPointer = {x, y, at}` cho **mọi** cú bấm trong app;
2. `openLink()` lấy toạ độ theo thứ tự: event (chỉ khi `clientX` hoặc `clientY` khác 0) → `lastPointer` **nếu vừa xảy ra trong 2 giây** → điểm mặc định `(rộng/2, cao/3)`.

Cái mốc 2 giây không phải số cho đẹp: link mở do **timer hoặc bàn phím** thì điểm bấm cuối có thể ở tận đâu và cũ vài chục giây — neo vào đó tệ hơn neo giữa màn hình, vì nó *trông như* có chủ đích.

Đo: `pointerdown` tại `(1180, 700)` rồi gọi `openLink()` **không truyền event** ⇒ popover ở `(1120, 690)`, không ở góc.

## Vì sao chỉ một listener

`useLinkOpen().installInterceptor()` đăng ký **một** listener `click` ở pha capture trên `document`, lọc `a[href^=http]` + chuột trái + `!defaultPrevented`. Nhờ vậy mọi `<a>` trong app được phủ **mà không sửa call site nào**:

- markdown trong transcript (`SessionMarkdownHtml`, `SessionLinkedText`)
- `ProjectOverview`, `ProjectGhDrawer`, `WorkspaceInfo`, `OfficeDocPara`
- và bất cứ `<a>` nào thêm sau này

Surface nào muốn tự lo hành vi link thì đánh dấu `data-link-raw`. Chip đường-dẫn-file trong transcript **không** bị ảnh hưởng: href của chúng là path tương đối, không khớp `^http`.

Còn những chỗ mở link **bằng lệnh** (không phải `<a>`) thì đã đổi sang `useLinkOpen().openLink(url)`:

| Chỗ | Link gì |
|---|---|
| `TopBarNotifications` (3), `useGhNotifications`, `usePrWatch` | thread GitHub / PR |
| `stores/git.ts` | trang PR/repo của branch |
| `TaskSourceBadge` | issue/PR nguồn của task |
| `useSessionMediaIndex` | link trong tab Info của session |
| `TemplateDetail`, `TemplateConsentPanel` | homepage của template |
| `ConnectionDiscoverDetail` | repo của MCP server |
| `GitAuthErrorModal` | trang trợ giúp GitHub |
| `SettingsAbout` | repo AWOG |
| `ProjectGh` (2) | trang cài đặt / hướng dẫn đăng nhập `gh` CLI |

## Bốn chỗ cố ý KHÔNG hỏi

| Chỗ | Vì sao |
|---|---|
| `SettingsOAuthDialog` (Claude) | luồng OAuth phải vào browser có **phiên thật** của người dùng; auth code **không được** rơi vào jar của agent |
| `SettingsCodexDialog` (OpenAI) | như trên |
| `SettingsDevices` → tải Tailscale | partition của agent **chặn download** (`will-download` → `preventDefault`), nên "mở trong app" là ngõ cụt |
| `stores/connections.ts` → `source.oauth-url` | URL authorize của MCP source: cùng lý do hai dialog trên — phải vào browser giữ phiên thật, auth code không được vào jar của agent |

Cả bốn có comment ghi lý do ngay tại dòng, để lần sau không ai "dọn dẹp" cho nhất quán.

## Link bên trong trang của agent

`setWindowOpenHandler` của trình duyệt nhúng đổi từ `deny` sang **mở tab thật** (vẫn qua `hostBlocked`, vẫn trả `deny` để Chromium không tự tạo cửa sổ). Hồi bề mặt còn headless thì chặn là đúng — không ai thấy một cú bấm không làm gì; giờ người dùng ngồi xem trang nên cú bấm chết đọc ra như app hỏng.

## Giới hạn

- **Link trong iframe** (artifact HTML ở PreviewModal, widget do model sinh) vẫn bị `will-frame-navigate` **chặn thẳng**, không hỏi. Đó là hàng rào chống exfiltrate ở [window.ts](../../apps/desktop/electron/src/window.ts) — không phải chỗ bỏ sót.
- Surface **không mount `AppGlobalHosts`** (tray popover) không có popover; link ở đó vẫn ra browser ngoài qua lưới an toàn ở main.
- Mode lưu ở `localStorage` (`awog.linkOpenMode`) nên **theo từng cửa sổ/profile renderer**, không đồng bộ qua IPC — nó chỉ chọn bề mặt mở link, engine không thấy gì; cùng hình dạng với `useKeymap`.

## File chạm

| File | Thay đổi |
|---|---|
| [ui-next/composables/useLinkOpen.ts](../../apps/desktop/ui-next/composables/useLinkOpen.ts) | **Mới** — mode + `openLink`/`openInApp`/`openExternally` + listener capture `click` **và `pointerdown`** (neo popover) |
| [ui-next/components/LinkOpenHost.vue](../../apps/desktop/ui-next/components/LinkOpenHost.vue) | **Mới** — popover neo tại chỗ bấm; cũng là nơi cài listener |
| [ui-next/components/AppGlobalHosts.vue](../../apps/desktop/ui-next/components/AppGlobalHosts.vue) | mount host (cả cửa sổ chính lẫn session popout) |
| [ui-next/components/settings/SettingsWorkspace.vue](../../apps/desktop/ui-next/components/settings/SettingsWorkspace.vue) | hàng **Mở link** |
| 12 file call site | `openExternal` → `openLink` (bảng trên) |
| 4 file bypass | thêm comment lý do |
| [electron/src/browser.ts](../../apps/desktop/electron/src/browser.ts) | `setWindowOpenHandler` mở tab thay vì `deny` |
| i18n `common.json` + `settings.json` (en/vi) | 3 + 5 key |
