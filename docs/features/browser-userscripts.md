# Userscript trong trình duyệt nhúng

- **Trạng thái:** Đã code (sidecar + Electron main + UI), 2026-10-13
- **ADR:** [0104 — Userscript kiểu Tampermonkey](../decisions/0104-browser-userscripts.md)

## Dữ liệu

Userscript là **global** (mọi hồ sơ trình duyệt dùng chung — script thuộc về người, không về hồ sơ), mỗi script có công tắc bật/tắt.

- `~/.awog/browser/userscripts/<id>.user.js` — nguyên văn nguồn (kèm header `==UserScript==`).
- `~/.awog/browser/userscripts/index.json` — `{ version: 1, scripts: [{ id, enabled, createdAt, updatedAt }] }`. **Không** chứa metadata: nó suy ra từ header mỗi lần đọc (cache theo `updatedAt`), nên sửa file bằng tay không làm lệch.
- `id` = `us-<8 hex>` (khớp `^us-[0-9a-f]{8}$`, kiểm ở mọi biên trước khi chạm đường dẫn). Nguồn ≤ 512KB, ≤ 200 script. Ghi nguyên tử (`.tmp` + rename) trong hàng đợi tuần tự.
- Code: [`sidecar/src/browser-userscripts/`](../../apps/desktop/sidecar/src/browser-userscripts/) (`meta.ts` parser + bộ biên dịch luật, `store.ts`, `fetch.ts`) và RPC ở [`methods/userscripts.ts`](../../apps/desktop/sidecar/src/methods/userscripts.ts).

### Metadata hỗ trợ

`@name` (bắt buộc, ≤ 200 ký tự), `@namespace`, `@version`, `@description`, `@match` (Chrome match pattern, nhiều dòng), `@include`/`@exclude` (glob `*` không phân biệt hoa/thường, hoặc `/regex/flags`), `@run-at` (`document-start` · `document-end` mặc định · `document-idle`), `@noframes`, `@grant`, `@require`. Khoá lạ và `@name:xx` bị bỏ qua.

**Cảnh báo (`warnings`)** — script vẫn được lưu: `@grant` ngoài `none`/`GM_addStyle`/`GM_info`/`unsafeWindow` ⇒ API đó *không tồn tại* lúc chạy; mọi `@require` ⇒ không tải; `@run-at` lạ ⇒ về `document-end`; pattern/regex hỏng ⇒ bị bỏ qua; không còn luật hợp lệ nào ⇒ "sẽ không bao giờ chạy". Thiếu header hoặc `@name`, nguồn quá lớn, quá 200 script ⇒ **lỗi** (`-32602`, UI hiện nguyên văn).

### Luật khớp URL

Chạy khi `(@match ∪ @include)` khớp **và không** `@exclude` (exclude luôn thắng); chỉ `http(s)`.

- `@match`: `<all_urls>` hoặc `scheme://host/path`. Scheme `*` = http|https (scheme khác bị từ chối). Host: `*` · `*.x.y` (khớp `x.y` **và** mọi subdomain) · tên chính xác; `*` ở chỗ khác trong host là lỗi. Port không khai = mọi port (như Chrome); khai thì phải đúng. Path là glob `*`; fragment luôn bị bỏ qua.
- `@include`/`@exclude`: glob `*` (⚠ `*.github.com` **không** khớp `github.com` trần — đúng Tampermonkey) hoặc `/regex/flags` (chỉ `imsu`; `g`/`y` bị bỏ vì làm `test()` có trạng thái). Mọi luật thử trên `href` đầy đủ do `new URL` chuẩn hoá.
- Cài đặt **một chỗ**: `compileRules()` ở sidecar biến luật thành `{source, flags}[]`; `matchesUserscript(meta, url)` (test bằng vitest) dùng chính nó. Electron main và wrapper trong trang chỉ **chạy** regex đã biên dịch, không có bộ so khớp thứ hai.

## RPC (sidecar)

| Method | Params | Trả về |
|---|---|---|
| `userscripts.list` | — | `{ scripts: { id, enabled, meta, warnings, updatedAt }[] }` |
| `userscripts.get` | `{ id }` | `{ id, source }` |
| `userscripts.save` | `{ id?, source }` | item (tạo khi vắng `id`, mặc định bật) |
| `userscripts.setEnabled` | `{ id, enabled }` | item |
| `userscripts.remove` | `{ id }` | `{ ok: true }` |
| `userscripts.importUrl` | `{ url }` | item — tải **và lưu**; cùng `@namespace`+`@name` với script có sẵn ⇒ cập nhật tại chỗ (giữ cờ bật) |
| `userscripts.snapshot` | — | tập đầy đủ cho main (xem dưới) |

Mọi lần ghi phát event `userscripts.changed` và đẩy tập mới sang main qua host request **`browser.setUserscripts { scripts }`**. Mỗi phần tử: `{ id, enabled, meta, rules: { include, exclude }, source }` — **cả script đang tắt** (để menu ⋮ hiện được "khớp nhưng tắt"), nhưng `source` chỉ có khi bật. Main còn tự **kéo** `userscripts.snapshot` lúc app mở và khi `engine.restarted` (lần đẩy trước có thể hụt khi main chưa sẵn sàng; sidecar không đẩy lúc khởi động vì main đã kéo).

`importUrl`: chỉ **https**, qua `assertSafeUrl` (protocol + host literal + DNS-resolve từng IP — cùng cổng với WebFetch/browser_tool), redirect đi tay ≤ 3 hop và hop nào cũng kiểm lại, trần 512KB, timeout 15s.

## Runtime (Electron main)

Code: [`browser-userscript-core.ts`](../../apps/desktop/electron/src/browser-userscript-core.ts) (thuần: kiểm payload, chạy luật, dựng wrapper, đọc báo cáo — test bằng `node --test`) và [`browser-userscripts.ts`](../../apps/desktop/electron/src/browser-userscripts.ts) (host gắn vào từng tab của `BrowserController`).

- **Page world**, như Tampermonkey `@grant none`. Đường chính: CDP `Page.addScriptToEvaluateOnNewDocument` — **mỗi script một đăng ký riêng** (lỗi cú pháp của một script không kéo theo script khác; nó được phát hiện trước bằng `vm.Script` và hiện ở menu như lỗi). Chạy trước script của trang nên `document-start` đúng nghĩa. Đăng ký lại khi tập đổi hoặc debugger attach lại (đóng DevTools).
- **Wrapper trong trang** kiểm lại URL (`location.href`, vì CDP gắn vào mọi document kể cả iframe), tôn trọng `@noframes` (`window.top !== window`) và `@run-at` (`document-end` ⇒ `DOMContentLoaded` hoặc ngay; `document-idle` ⇒ sau `load`), bọc try/catch. Mã người dùng là thân của một `function` — **không `eval`/`new Function`**, nên CSP của trang không chặn.
- **Môi trường**: `unsafeWindow` (= `window`) luôn có; `GM_addStyle`/`GM_info` chỉ khi khai `@grant`; mọi `GM_*` khác `undefined`. `GM_addStyle` tạo `<style>`; nếu CSP `style-src` chặn nó (không có `sheet`) thì rơi về `adoptedStyleSheets` (đã đo trên trang `style-src 'none'`).
- **Đường lùi** khi debugger không có (DevTools đang mở, attach lỗi): `executeJavaScript` ở `dom-ready` cho trang khớp ⇒ `document-start` **trễ** (trang đã chạy script của nó trước).
- ⚠ **Trang ĐẦU TIÊN của tab mới luôn đi đường lùi** (đo trên Electron 33): đăng ký CDP đồng thời với `loadURL` đầu tiên không áp vào document đầu, và `await` đăng ký trước `loadURL` thì **treo** (lệnh CDP của tab chưa từng điều hướng chỉ được xử lý khi điều hướng đầu đã bắt đầu). Host chụp `docCovered` lúc điều hướng bắt đầu để quyết định đường lùi cho từng document ⇒ document-end/idle vẫn chạy, chỉ `document-start` trễ trên đúng lần tải đó; từ lần điều hướng thứ hai của tab thì đúng nghĩa. Phải `Page.enable` trước khi đăng ký (không có thì script đăng ký xong mà không bao giờ chạy — đo được).
- **Báo cáo** về main qua `console.debug` mang tag ngẫu nhiên theo tiến trình (`ran` khi bắt đầu chạy, `error` khi ném); `console-message` handler của `browser.ts` **bỏ** các dòng này nên không lọt vào ring console mà agent đọc. Trang là L1 (đọc được console, có thể giả báo cáo) — kết quả chỉ để hiển thị.
- **Theo tab**: `ran` (script đã chạy trên document hiện tại + lỗi; reset khi điều hướng khác document) và `matching` (mọi script khớp URL, kể cả đang tắt) → IPC `browser:userscriptsForTab { tabId, scope }` → `{ ran: { id, name, error? }[], matching: { id, name, enabled }[] }` (cùng cổng `this.tab(tabId, scope)` ⇒ một surface không hỏi được tab scope khác). Đổi tập/bật-tắt chỉ có hiệu lực ở lần tải kế tiếp.

## Bảo mật

- **Chỉ http(s)**: wrapper kiểm `location.protocol`; không bao giờ chạy trên `about:`, `file:`, `wspreview://`, hay chính app AWOG (tab của trình duyệt nhúng không phải renderer của app).
- **Không mạng** cho script: cố ý không có `GM_xmlhttpRequest` hay `@require` (không tải mã bên thứ ba, không vượt same-origin). Script chạy trong page world nên vẫn dùng `fetch` của trang với quyền của trang đó.
- ⚠ **Script chạy cả trên trang agent duyệt** và có thể đổi những gì agent đọc (nội dung DOM, kết quả `extract`/`snapshot`). Đây là tính năng, không phải lỗi — nhưng người cài script chịu trách nhiệm về những gì agent thấy. Agent **không có tool** tạo/sửa script (vòng này).
- **Regex @include của người dùng** có thể backtrack thảm hoạ: main chạy chúng trong `vm` có timeout 25ms (đã đo ngắt được `^…(a+)+$`) để không treo tiến trình chính; trong trang thì chỉ treo chính trang đó.
- **Payload từ sidecar** được kiểm lại ở main (kiểu, độ dài, cờ regex chỉ `imsu`, id đúng định dạng) — sai hình dạng ⇒ ném, không chạy tập lệch.
- **Import URL** đi qua cổng SSRF (xem trên). Nguồn ghi `0600`, thư mục `0700`.

## Kiểm chứng

- Sidecar: `npx vitest run src/browser-userscripts` (parser: metadata/mặc định/cảnh báo; matcher: `*://*.github.com/*`, `https://example.com/path*`, `<all_urls>`, port, glob+regex, exclude thắng, pattern hỏng; store CRUD trên HOME tạm; cổng chặn của importUrl).
- Electron: `node --test` trên `browser-userscript-core.test.js` (payload, luật, ngắt regex, wrapper biên dịch được, báo cáo).
- Kiểm thật trên `BrowserController` trong Electron riêng (`--user-data-dir` tạm, HTTP server cục bộ, 24 phép đo, đã xoá script kiểm sau khi chạy): document-start đặt biến trước script trang · document-end thêm node · `GM_addStyle` đổi màu (kể cả dưới CSP `style-src 'none'`) · script không khớp không chạy · `@exclude` thắng · script ném lỗi / lỗi cú pháp được báo mà không làm hỏng script khác · `@noframes` · tắt rồi tải lại thì dừng · đường lùi khi mất debugger · attach lại thì đăng ký lại.

## UX

### Nơi đặt: Settings → Userscript (section riêng)

Section riêng `userscripts` (nhóm Workspace, cạnh "Hồ sơ trình duyệt"), không phải sub-card của hồ sơ, vì:

- Script là **global** — chạy ở mọi hồ sơ trình duyệt. Mọi thứ trong "Hồ sơ trình duyệt" là theo-hồ-sơ; để chung sẽ gợi ý sai rằng script thuộc một hồ sơ.
- `SettingsBrowser.vue` đang là điểm nóng (proxy theo hồ sơ); component mới tránh phình thêm file đó.

Component: [`SettingsUserscripts.vue`](../../apps/desktop/ui-next/components/settings/SettingsUserscripts.vue). Mỗi hàng: tên · version · badge cảnh báo (tooltip + danh sách cảnh báo dưới hàng) · mô tả · tóm tắt `@match`/`@include` (2 pattern đầu + `+N`, đủ danh sách ở tooltip) · `@run-at` · nút sửa / xoá (icon-only, có `title`) · công tắc bật/tắt. Thanh trên: **Thêm script**, **Nhập từ URL** (ô nhập inline; sidecar tải https-only và LƯU luôn). Xoá đi qua `confirm()` vì mất cả mã nguồn người dùng viết. Banner đầu trang nói rõ: script cũng chạy trên trang agent duyệt, `GM_xmlhttpRequest`/`@require` cố ý không hỗ trợ.

### Soạn / sửa

[`UserscriptEditorModal.vue`](../../apps/desktop/ui-next/components/userscript/UserscriptEditorModal.vue): Monaco (lazy-load) soạn **toàn bộ nguồn** gồm khối `==UserScript==`. Không có form metadata riêng — sidecar parse header lúc lưu nên UI không thể lệch khỏi nguồn. Lỗi parse/validate do sidecar ném hiện ngay dưới editor, modal không đóng. Lưu thành công nhưng có cảnh báo ⇒ toast. `⌘S` lưu. Modal là `.ovl.on` nên nằm trong danh sách OVERLAYS của browser panel (view native nhường chỗ).

Mẫu mới: [`buildUserscriptTemplate(pageUrl)`](../../apps/desktop/ui-next/composables/useUserscripts.ts). Mở từ Settings ⇒ `@match https://example.com/*`; mở từ trình duyệt ⇒ `@match *://<host>/*` của tab (chỉ origin; URL không phải http(s) rơi về ví dụ).

### Menu ⋮ của trình duyệt

Submenu **Userscript trên trang này** ([`useTabUserscripts.ts`](../../apps/desktop/ui-next/composables/useTabUserscripts.ts), ghép vào `BrowserOverflowMenu`):

- Liệt kê script **khớp URL của tab** (kể cả đang tắt). ✓ = công tắc BẬT (bấm để đảo); hint = `Đã chạy` / `Lỗi: …` / `Đang tắt`; icon ⚠ khi script ném lỗi.
- **Tạo script cho trang này…** mở editor với mẫu đã điền `@match`; **Quản lý userscript…** nhảy tới Settings → Userscript.
- "Khớp" và "đã chạy" là câu trả lời của Electron main (`browser.userscriptsForTab`) — nơi duy nhất thực sự khớp URL và chạy script, nên UI không tự khớp lại. Hỏi một lần lúc menu mở (không poll).

### i18n

`i18n/locales/{vi,en}/userscripts.json` (tự nạp bằng glob).

### Ghi chú phát hiện khi làm UI

`components/ui/switch/Switch.vue` từng chuyển `checked` thẳng qua `$attrs`, mà `reka-ui` 2.9.x chỉ còn `modelValue` ⇒ công tắc lật trạng thái nội bộ nhưng model của caller không bao giờ đổi (đo: `SettingsTog` bấm xong `modelValue` vẫn `false`) — tức MỌI công tắc Settings không lưu. Đã sửa ở wrapper: `Switch` khai prop `checked` + emit `update:checked` và dịch sang `modelValue`; mọi caller (kể cả section này) dùng `:checked`/`@update:checked`.
