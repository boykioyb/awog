# Hồ sơ trình duyệt + bookmark

Trạng thái: **đã code (UI, sidecar, Electron)** — quyết định kiến trúc ở ADR 0101. Tài liệu này là spec phía UX + dữ liệu + bảo mật; chi tiết cơ chế partition nằm ở [session-browser-panel.md](session-browser-panel.md).

## Vấn đề

Trình duyệt nhúng ([ADR 0086](../decisions/0086-embedded-browser-panel.md)) dùng **một** partition `persist:awog-browser` cho mọi tab của mọi phiên: một login Google duy nhất, một jar cookie duy nhất, và "ghim" chỉ là danh sách 12 URL trong `localStorage`. Người dùng làm nhiều khách hàng/tài khoản không tách được đăng nhập theo dự án, và không có bookmark thật (thư mục, thanh bookmark, sửa/xoá).

## Quyết định (người dùng chốt)

1. **Bookmark thay hẳn pin.** Thanh bookmark kiểu Chrome dưới hàng URL + ☆ trong ô URL + menu "Tất cả bookmark". Pin cũ chuyển một lần vào bookmark của hồ sơ mặc định rồi cơ chế pin bị xoá.
2. **Một cấp thư mục.** Thanh hiện bookmark + thư mục; thư mục mở thành dropdown. Không thư mục lồng nhau.
3. **Hồ sơ theo PHIÊN.** Hồ sơ hiệu lực = `Session.browserProfileId` ?? `Project.browserProfileId` (project của phiên) ?? hồ sơ mặc định toàn app. Đổi hồ sơ trong menu ⋮ đặt override cho phiên đó; tab của phiên đóng và mở lại (cùng URL) ở partition mới. Agent của phiên dùng đúng hồ sơ đó. Scope `task:<id>` dùng hồ sơ của project của task ?? mặc định; pool global (không scope) dùng mặc định.

## Mô hình dữ liệu

Sidecar sở hữu dữ liệu (UI chỉ là bản chiếu):

| Thứ | Nơi lưu |
|---|---|
| Danh sách hồ sơ + hồ sơ mặc định | `~/.awog/browser/profiles.json` — `{ version:1, defaultProfileId, profiles:[{id,name,color,createdAt}] }`; luôn có `default` ("Mặc định"), không xoá được |
| Bookmark của một hồ sơ | `~/.awog/browser/profiles/<id>/bookmarks.json` — `{ version:1, items: BookmarkNode[] }` |
| Override của phiên | `browserProfileId` trong header phiên (`sessions.setBrowserProfile`, `null` = xoá override) |
| Hồ sơ của project | `Project.browserProfileId` (đi qua `projects.upsert`, y như `githubAccount`) |
| Cookie/login | partition Chromium: `default` → `persist:awog-browser` (giữ nguyên login + dữ liệu đã nhập từ Chrome); hồ sơ khác → `persist:awog-browser-<id>` |

`BookmarkNode` = `url {id,title,url,createdAt}` hoặc `folder {id,title,createdAt,children: url[]}`. Id hồ sơ: `default` hoặc `[a-z0-9-]{1,32}` (sidecar cấp `p-<8 hex>`). URL chỉ `http(s)`, tiêu đề ≤ 200, ≤ 500 mục.

## Thứ tự ưu tiên

```
Session.browserProfileId   (override người dùng đặt trong menu ⋮ của phiên đó)
  ?? Project.browserProfileId   (Project → Tổng quan → "Hồ sơ trình duyệt")
  ?? defaultProfileId           (Settings → Hồ sơ trình duyệt → "Đặt làm mặc định")
```

Luật này chạy **một nơi duy nhất** (sidecar, `browserProfiles.resolveScope`). Renderer không tự tính: nó hỏi `window.awog.browser.profileOf(scope)`; main cache và được sidecar đẩy `browser.setScopeProfile` mỗi khi có thể đổi. Tab trả về `profileId` để chrome hiện đúng ngay không chờ IPC.

## UX

### Thanh bookmark (`BrowserBookmarkBar.vue`, nằm trong `BrowserNavBar`)

- Hàng dưới ô URL, mặc định cao ~28px. Chip: icon + nhãn (title → host → URL). Chip của trang đang xem tô accent-tint.
- **Bấm** = điều hướng tab đang xem; **⌘/Ctrl-click** hoặc chuột giữa = tab mới.
- **Thư mục**: bấm mở dropdown các bookmark con. **Phần tràn** → nút `»` (đo bằng một hàng ẩn + `ResizeObserver`, không cắt giữa chừng).
- **Chuột phải**: Mở · Mở trong tab mới · Sửa · Xoá (thư mục: Sửa = đổi tên). Không hỏi xác nhận khi xoá bookmark (như Chrome); xoá thư mục xoá cả con.
- **Rỗng**: một dòng gợi ý chỉ tới ☆.
- Mọi dropdown/menu là `AppContextMenu` (`.smenu`) và hộp sửa là modal `.ovl.on` — **bắt buộc**: view native của trang vẽ đè lên DOM, và chỉ các selector trong `OVERLAYS` của `useEmbeddedBrowser` mới khiến trang nhường chỗ.

### ☆ trong ô URL (`BrowserNavBar`)

Chưa có bookmark → bấm thêm ngay vào thanh rồi mở hộp sửa (tên + thư mục, có "Thư mục mới…"); đã có (★ tô accent) → bấm mở hộp sửa (có nút Xoá). Tắt khi trang không phải `http(s)`. URL so sánh bỏ `/` cuối (`wc.getURL()` chuẩn hoá `https://x.com` thành `https://x.com/`).

### Menu ⋮ (`BrowserOverflowMenu`)

- **Tất cả bookmark** — danh sách phẳng (thư mục thành hàng tiêu đề).
- **Hồ sơ: <tên>** (chấm màu) → submenu: từng hồ sơ (✓ = đang dùng), "Theo project / mặc định của app" (gỡ override), "Quản lý hồ sơ…" (mở Settings). Đổi hồ sơ chỉ bật được khi tab thuộc một **phiên** thật; pool global và scope task chỉ đọc (disabled + hint "Chỉ cho phiên").
- **Nhập cookie** và **Xoá dữ liệu duyệt web** nay tác động lên **hồ sơ hiện tại** (không còn mặc định mù quáng vào jar duy nhất); modal nhập hiện tên hồ sơ.

### Settings → Hồ sơ trình duyệt (`SettingsBrowser.vue`)

Danh sách hồ sơ: chấm màu, tên, nhãn "Mặc định". Mỗi hàng: Đổi tên (+ 8 màu) · Đặt làm mặc định · Nhập từ trình duyệt… · Xoá dữ liệu duyệt web · Xoá hồ sơ (không hiện với `default`). **Xoá hồ sơ** có `confirm()` nói rõ login + cookie + bookmark mất vĩnh viễn; phiên/project đang dùng nó quay về mặc định (sidecar dọn tham chiếu, main xoá partition).

### Proxy theo hồ sơ — UX (`SettingsBrowserProxy.vue`, ADR 0103)

- Mỗi hàng hồ sơ có nút **Proxy** mở editor tại chỗ (cạnh Đổi tên…): loại **Tắt / HTTP / HTTPS / SOCKS5**, máy chủ + cổng, đăng nhập (user/pass), danh sách **Bỏ qua** (bypass), **Lưu**, **Kiểm tra**. Hồ sơ đang có proxy hiện chip `HTTP host:port` ở đầu hàng.
- **Lối vào từ chính trình duyệt:** nút **quả địa cầu** ngay cạnh ☆ trong ô URL (`BrowserNavBar`, cụm `.bch-urltools`) mở `BrowserProxyModal.vue` — cùng editor trên cho **hồ sơ đang dùng** của tab. Nút vừa là chỉ báo (accent khi hồ sơ đi qua proxy, tooltip `Proxy / VPN: host:port — bấm để đổi`) vừa là lối mở. Lịch sử: bản đầu chỉ có Settings → Hồ sơ trình duyệt (người dùng không tìm thấy), bản hai thêm mục trong menu ⋯ (vẫn bị chê là giấu) ⇒ nay ra thanh địa chỉ, mục menu ⋯ và icon khiên trong lớp đọc đã gỡ.
- **Mật khẩu không bao giờ quay lại renderer**: `browserProfiles.list` chỉ trả `hasAuth`. Có creds thì UI hiện "Đã lưu đăng nhập" + **Thay** / **Xoá**; không động tới thì Save gửi `auth` vắng (giữ nguyên), Xoá ⇒ `auth: null`, Thay ⇒ `{username,password}`. Ô user/pass được xoá khỏi state sau khi Save.
- **SOCKS5 + đăng nhập**: Chromium không hỗ trợ ⇒ ô đăng nhập bị thay bằng lời giải thích; Save tự gửi `auth: null` (xoá creds cũ nếu có). Sidecar cũng từ chối ở biên.
- **Kiểm tra** (chỉ trong app desktop, `window.awog.browser.testProxy(profileId)`): chạy trên cấu hình **đã lưu** nên bị khoá khi form đang sửa dở hoặc chưa có proxy; hiện `IP · quốc gia` hoặc lỗi.
- **Chỉ báo**: chính nút quả địa cầu ở trên (host:port lấy từ danh sách hồ sơ; cờ `AwogBrowserTab.proxied` từ main quyết định sáng hay không khi danh sách chưa nạp). Dòng hồ sơ ở menu ⋮ thành `Hồ sơ: <tên> · Proxy host:port`, từng hồ sơ trong submenu hiện `TYPE host:port` ở hint.

### Project → Tổng quan

Trường "Hồ sơ trình duyệt" cạnh "Tài khoản GitHub": `Mặc định của app (<tên>)` hoặc một hồ sơ cụ thể. (Trường GitHub nằm ở `ProjectOverview.vue`, không phải `ProjectEditor.vue` — trường mới đi cùng chỗ với nó.)

### Empty-state

Card bấm-mở lấy từ bookmark của hồ sơ hiệu lực (thư mục trải phẳng, tối đa 12).

## Migration pin → bookmark

Lần đầu `useBookmarks()` chạy: nếu `localStorage['awog.browserPins']` còn → `bookmarks.importPins {profileId:'default', pins}` (idempotent theo URL) → **chỉ khi RPC thành công** mới xoá khoá. Mất engine giữa chừng thì lần mở sau thử lại, không mất pin. Sau đó `useBrowserPins.ts` và `BrowserPinStrip.vue` đã bị xoá, i18n `sessions.workspace.browser.pin/unpin` cũng vậy.

## Bảo mật

- Sidecar validate mọi RPC (zod): id hồ sơ theo regex, URL `http(s)`, trần số mục; đường dẫn thư mục hồ sơ dựng từ id đã validate (không nhận path từ UI). Electron từ chối id sai regex ở `partitionForProfile`.
- Hồ sơ **không** chia sẻ cookie với nhau — đó là mục đích. Agent của một phiên chỉ thấy partition của hồ sơ phiên đó.
- Màu hồ sơ là dữ liệu người dùng (chuỗi ≤ 40 ký tự do sidecar lưu nguyên) chỉ đi vào `style` (`background`), không bao giờ vào HTML/`v-html`.
- Không secret nào xuống UI: bookmark/hồ sơ không chứa credential; login nằm trong partition ở main.
- Title/URL bookmark là L1 (có thể đến từ trang): chỉ render bằng interpolation, URL chỉ đi qua `open`/`newTab` của bridge (đã có `hostBlocked` + chính sách host).

## Tệp UI

| Tệp | Vai trò |
|---|---|
| `composables/useBrowserProfiles.ts` | state hồ sơ cấp module + `useScopeProfile` (hồ sơ hiệu lực của scope) + bảng màu |
| `composables/useBookmarks.ts` | cây bookmark theo hồ sơ, RPC, event, migration pin |
| `components/browser/BrowserBookmarkBar.vue` | thanh bookmark + dropdown + `»` + chuột phải |
| `components/browser/BrowserBookmarkDialog.vue` | hộp thêm/sửa |
| `components/browser/BrowserNavBar.vue` | ☆, gắn thanh + hộp, `open-url` |
| `components/browser/BrowserOverflowMenu.vue` | Tất cả bookmark · Hồ sơ · nhập/xoá theo hồ sơ |
| `components/settings/SettingsBrowser.vue` | quản lý hồ sơ |
| `components/project/ProjectOverview.vue` | trường hồ sơ của project |

## Giới hạn đã biết

- `BrowserNavBar` phát `open-url`; mỗi bề mặt (`BrowserChrome`, `SessionDetail` main-tab, `DocWeb`) tự quyết "điều hướng tab đang xem" hay "tab mới". Thêm bề mặt mới = nhớ nối `@open-url`.
- Đổi hồ sơ làm tab của phiên **nháy** (đóng + mở lại) và mất trạng thái trang (form chưa gửi) — toast báo trước.
- Menu `AppContextMenu` chỉ có một cấp submenu nên "Tất cả bookmark" trải phẳng thư mục.

## Proxy theo hồ sơ ("VPN" của hồ sơ) — dữ liệu + runtime

Mỗi hồ sơ có thể đặt **một proxy riêng**: chỉ tab của hồ sơ đó đi qua proxy, không phải cả máy. Chỉ **người dùng** đặt được (Settings → Trình duyệt); không tool nào của agent chạm tới.

- **Dữ liệu** (`profiles.json`, không bí mật): `proxy?: { type: 'http' | 'https' | 'socks5', host, port, bypass?, hasAuth }`. Validate ở `sidecar/src/browser-profiles/proxy-config.ts`: host là hostname/IPv4/`[IPv6]` ≤253 ký tự (không scheme/path/khoảng trắng), port 1–65535, `bypass` là chuỗi `proxyBypassRules` của Chromium ≤500 ký tự (bảng ký tự giới hạn). Host loopback/private **được phép** (client proxy cục bộ `127.0.0.1:1080` là ca phổ biến).
- **Credential** `{ username, password }` chỉ ở **OS keychain** (service `awog-browser-proxy`, account = id hồ sơ, `proxy-auth.ts`). Không vào file, RPC result hay event lên renderer; chỉ đi sidecar → main qua host request, main giữ trong RAM.
- **SOCKS5 + username/password bị từ chối** ở biên sidecar (Chromium không làm được) — cũng khi chuyển sang socks5 mà vẫn còn credential đã lưu (phải gửi `auth: null`).
- **RPC:** `browserProfiles.setProxy { id, proxy | null, auth?: {username,password} | null }` (`auth` vắng = giữ credential cũ, `null` = xoá; `proxy: null` xoá cả credential) → hồ sơ đã cập nhật (có `hasAuth`), phát `browser.profiles-changed`. `browserProfiles.syncProxies` (main gọi) đẩy lại trạng thái của **mọi** hồ sơ. Xoá hồ sơ ⇒ xoá entry keychain + đẩy `proxy: null`.
- **Sidecar → main:** host request `browser.setProfileProxy { profile, proxy | null, auth? }` khi `setProxy`, khi xoá hồ sơ, và khi main đồng bộ (khởi động, `engine.restarted`, `browser.profiles-changed`). Main validate lại payload (`electron/src/browser-proxy.ts`).
- **Áp dụng** (`browser.ts`): `ensurePartition` + mỗi lần đổi ⇒ `session.setProxy({ proxyRules: '<scheme>://host:port', proxyBypassRules: '<bypass>,<local>' })` rồi `closeAllConnections()` (tab đổi tuyến ngay); `null` ⇒ `{ mode: 'direct' }`. `socks5://` ⇒ DNS phía proxy. Đẩy lại cấu hình không đổi thì bỏ qua (không cắt kết nối vô cớ).
- **Fail-closed:** trước lần đồng bộ đầu tiên, partition "chưa biết trạng thái" bị chặn (proxy loopback cổng 1) thay vì đi thẳng, để hồ sơ có proxy không lọt ra mạng trực tiếp lúc khởi động. Mọi lượt tải do AWOG khởi xướng (`navigate`, `openFromUser`, mở lại tab) đi qua `proxyReady()`: chưa đồng bộ thì kéo trạng thái về trước, rồi chờ `setProxy` của partition xong — vì `ensurePartition` áp proxy KHÔNG chờ, `loadURL` ngay sau `createTab` có thể đi trước nó và lộ IP thật đúng ở trang đầu. ⚠ Engine chết lúc khởi động ⇒ mọi hồ sơ bị chặn tới khi `engine.restarted`.
- **Xác thực proxy:** handler `app.on('login')` chỉ trả lời khi `authInfo.isProxy` **và** webContents thuộc đúng partition của hồ sơ có proxy **và** host:port khớp cấu hình; còn lại bỏ qua (mặc định = huỷ). Tối đa 3 lần/30s mỗi hồ sơ để credential sai không gây vòng lặp 407.
- **Test:** IPC `browser:testProxy { profileId }` ⇒ một `session.fetch('https://www.cloudflare.com/cdn-cgi/trace')` qua đúng partition (timeout 8s) ⇒ `{ ok, ip?, loc?, error? }`. `browser:tabs` (`TabInfo.proxied`) và `browser:profileOf` (`proxied`) chỉ trả cờ, không host/credential.
- **Đã đo trên Electron thật** (proxy HTTP CONNECT cục bộ): hồ sơ có proxy → proxy thấy `CONNECT example.com:443`; hồ sơ khác đi thẳng, proxy không thấy gì; proxy yêu cầu Basic auth → `login` được trả lời, trang tải; thiếu credential ⇒ trang lỗi, không có đường hầm; credential sai ⇒ dừng sau vài lần, không vòng lặp; `testProxy` ok có `ip`/`loc` (và `HTTP 407` rõ ràng khi thiếu credential).
- **Lưu ý SSRF:** `hostBlocked` + kiểm DNS private-IP của sidecar giữ nguyên; khi có proxy, sidecar phân giải DNS **cục bộ** còn trang phân giải **qua proxy** — hai kết quả có thể khác nhau.

## Proxy miễn phí

Cho người dùng **tìm proxy công cộng miễn phí, lọc theo vùng (quốc gia) và độ trễ đo thật**, rồi gán vào một hồ sơ trình duyệt (luồng gán dùng lại `browserProfiles.setProxy`, xem ADR 0103).

### Backend (`sidecar/src/browser-profiles/free-proxies.ts`)

- **Nguồn (hằng số, không nhận URL từ UI):** ProxyScrape v4 (`api.proxyscrape.com/v4/free-proxy-list/get`, tối đa 1000, http+socks5, elite+anonymous) và Geonode (`proxylist.geonode.com/api/proxy-list`, 500 mục mới kiểm tra gần nhất). Cả hai không cần key. Hai nguồn tải **song song**, timeout 15s mỗi nguồn; một nguồn chết không làm hỏng lời gọi — trạng thái từng nguồn nằm ở `sources[]`.
- **Chuẩn hoá:** bỏ socks4 (kiểu proxy của hồ sơ không có socks4), bỏ `transparent` (lộ IP thật), bỏ `alive:false`, bỏ mục thiếu mã quốc gia ISO2. Chỉ nhận **IPv4 literal** công cộng: loại loopback/private/link-local (dùng lại `blockedHostReason` của `mcp/http-client.ts`) + CGNAT 100.64/10, multicast/reserved ≥224, 0/8, 198.18/15; host/port còn qua `validateProxyConfig`. Gộp theo `id = type://host:port` (độ trễ lấy min, uptime lấy max, `sources` liệt kê nguồn). Độ trễ nguồn = `average_timeout` (ProxyScrape) / `responseTime` (Geonode), đơn vị ms. Cache RAM 10 phút (`refresh: true` bỏ qua); cả hai nguồn chết thì giữ cache cũ.
- **`freeProxies.list { countries?, types?, anonymity?, limit?, refresh? }`** → `{ fetchedAt, sources, countries:[{code,name,count}], items }`. `countries` tính sau lọc type/anonymity nhưng **trước** lọc quốc gia (để UI vẫn thấy số lượng các nước khác). `items` sắp theo uptime giảm dần rồi độ trễ nguồn tăng dần, cắt `limit` (mặc định 300).
- **`freeProxies.probe { ids[≤60] }`** → `{ probeId }` ngay; kết quả stream qua event `freeProxies.probed { probeId, id, ok, latencyMs? | error? }` và `freeProxies.probeDone { probeId }`. Id phải thuộc danh mục hiện tại — id lạ bị từ chối (`-32602`) **trước khi mở socket nào**. Đo **tunnel thật** tới `www.cloudflare.com:443`: HTTP → `CONNECT` rồi đòi `HTTP/1.x 200`; SOCKS5 → `05 01 00` ⇒ `05 00` ⇒ CONNECT theo domain ⇒ `rep = 00`. `latencyMs` = từ lúc bắt đầu connect tới lúc tunnel mở. Timeout 5s, 12 luồng, socket luôn `destroy`. Probe mới **huỷ** probe cũ (probe cũ không phát thêm event nào, kể cả `probeDone`). Không gửi credential hay payload ngoài handshake.
- **Mã lỗi probe:** `timeout`, mã `errno` (`ECONNREFUSED`…), `http <status>`, `socks-auth-required`, `socks-rep-<n>`, `bad-response`, `closed`.

### Bảo mật

- Proxy miễn phí do bên lạ vận hành: nội dung HTTPS vẫn được mã hoá nhưng họ **thấy hostname**, và **thấy/sửa được toàn bộ trang HTTP thường**; cookie/đăng nhập của hồ sơ chỉ được TLS bảo vệ ⇒ nên dùng **hồ sơ riêng, không đăng nhập**.
- Invariant #5: ra mạng chỉ gồm 2 host danh sách + handshake tới proxy trong danh mục, và chỉ khi người dùng chủ động bấm. Invariant #7: IP nội bộ bị lọc ở ingest. Agent không có tool nào cho tính năng này.

### Đo thực tế (2026-10-13, smoke trên nguồn thật)

ProxyScrape 1000 + Geonode 294 mục sau lọc, 53 quốc gia (NL 784, US 137, RU 70, DE 41…). Dò 40 ứng viên đầu: **10/40 mở được tunnel** (độ trễ 616–958 ms, một ca 4981 ms); phần còn lại timeout 20, ECONNREFUSED 7, http 400/500, socks-rep-5. Tức tỉ lệ sống thấp ⇒ UI phải sắp theo độ trễ đo và làm mờ mục hỏng.

### UI (`components/browser/FreeProxyPicker.vue` + `composables/useFreeProxies.ts`)

- Nằm trong editor proxy (`SettingsBrowserProxy.vue`, cả ở Settings → Hồ sơ trình duyệt lẫn modal ⋯) dưới tab **"Proxy miễn phí"** (tab còn lại: "Thủ công"). Mở tab **không** gọi mạng; banner cảnh báo (người lạ vận hành, dùng hồ sơ riêng không đăng nhập, HTTP thường bị thấy) luôn hiện.
- Bộ lọc: khu vực (select có tìm kiếm, kèm số lượng; chỉ có sau lần tìm đầu vì danh sách nước đến từ `freeProxies.list`) · loại (HTTP / SOCKS5 / cả hai). Bộ lọc áp dụng ở lần bấm **Tìm & đo tốc độ** kế tiếp; nút ⟳ = `refresh: true`.
- **Tìm & đo tốc độ** = `freeProxies.list` → lấy 40 ứng viên đầu (uptime cao, độ trễ nguồn thấp) → `freeProxies.probe`. Bảng điền dần theo `freeProxies.probed`: chạy được lên trên (độ trễ đo tăng dần, màu `--green` ≤400ms / `--amber` ≤1200ms / `--danger`), đang đo ở giữa, hỏng làm mờ ở cuối. Event tới trước khi `probe` trả `probeId` được đệm rồi xả; event của probe cũ bị bỏ.
- Mỗi dòng chạy được có **Dùng** (`browserProfiles.setProxy`, `auth: null`, giữ nguyên form tay đồng bộ) và nút icon **Tạo hồ sơ riêng rồi dùng** (tạo "Proxy miễn phí · <nước>" rồi gán; toast nhắc chuyển phiên sang hồ sơ đó qua ⋯ → Hồ sơ). Sau khi áp dụng hiện **Kiểm tra** (`browser.testProxy` của đúng hồ sơ vừa gán).
