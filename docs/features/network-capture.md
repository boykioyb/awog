# Network capture (bộ bắt request cho người dùng)

Tab Browser nhúng của AWOG (ADR 0086) có thêm một **bộ bắt request đầy đủ dành cho người dùng** (infosec): lịch sử request, header THÔ (cả `Cookie`/mọi dòng `Set-Cookie`), body, TLS, timing, frame WebSocket, xuất HAR, copy cURL, repeater và phát hiện bảo mật thụ động — kiểu DevTools Network + một phần Burp. Ring `tab.network` đã sạch-header dành cho `browser_tool` của agent **giữ nguyên, không đổi**.

## Dữ liệu, IPC, giới hạn, bảo mật (Electron main)

**File:** `electron/src/browser-capture-types.ts` (hợp đồng kiểu; bản sao ở `ui-next/types/network-capture.ts`, preload `import type` thẳng từ file này), `browser-capture-core.ts` (lõi THUẦN, không import `electron`), `browser-capture.ts` (nối debugger/IPC/cửa sổ), 2 móc nhỏ trong `browser.ts` (`captureOnCdp` ở listener `debugger.on('message')`, `captureDropTab` ở `webContents 'destroyed'`) + `BrowserController.captureHost()` (cổng sở hữu tab, SSRF `hostBlocked`, `proxyReady`). `browser-capture.ts` KHÔNG import `browser.ts`; `ipc.ts` nối hai bên qua `registerCaptureIpc(browser.captureHost())`.

**Luồng:** CDP `Network.*` (debugger đã gắn sẵn cho mỗi tab) → `CaptureStore.handle()` trả về danh sách _effect_ (`getResponseBody` lúc `loadingFinished`, `getRequestPostData` khi `hasPostData` mà thiếu `postData`) → wrapper chạy (tối đa 6 lượt song song/tab, lỗi nuốt có chủ đích vì redirect/204/WS không có body) → entry dơ được gom và đẩy qua kênh `browser:capture:event` mỗi ≤150 ms (`upsert` rồi `state`; `cleared` khi xoá / đóng tab). Phát tới mọi `BrowserWindow` của app; renderer tự lọc theo `tabId`.

**Ghi (recording):** MẶC ĐỊNH TẮT, theo từng tab, giữ nguyên qua các lần điều hướng cho tới khi `clear` (kiểu Burp). `stop` giữ entry. Đóng tab = bỏ toàn bộ capture + đóng cửa sổ inspector của tab. Chỉ ghi từ lúc `start`: request đang bay trước đó không có sự kiện gốc nên bị bỏ.

**Ánh xạ sự kiện:**

- Header thô: `requestWillBeSentExtraInfo` / `responseReceivedExtraInfo` thắng header của sự kiện gốc (có `Cookie`, mọi `Set-Cookie`); CDP gộp header trùng bằng `\n` ⇒ tách lại thành từng cặp, giữ thứ tự + trùng; pseudo-header h2 (`:authority`…) bỏ. ExtraInfo có thể tới TRƯỚC hoặc SAU sự kiện gốc: đệm theo `requestId`, gán cho hop sớm nhất còn thiếu loại đó (ExtraInfo không mang URL nên chỉ khớp được theo thứ tự — _[INFERENCE]_ chuỗi redirect mà có hop không sinh ExtraInfo (redirect nội bộ HSTS/cache) có thể lệch một hop; chưa gặp trong đo đạc).
- Redirect: `redirectResponse` trên `requestWillBeSent` đóng hop trước (`status` 3xx, `redirectedTo`, timing) và mở hop mới. **Hop đầu giữ `id = requestId`, các hop sau `requestId#1`, `#2`…** (mỗi hop giữ id của mình, id không bao giờ đổi sau khi đã phát).
- Timing (ms, từ `response.timing`): `blocked` = (requestTime − lúc yêu cầu) + mốc bắt đầu đầu tiên, `dns`, `connect` (**gồm** `ssl`, đúng DevTools/HAR), `ssl`, `send`, `wait` = receiveHeadersEnd − sendEnd, `receive` = (loadingFinished − requestTime)·1000 − receiveHeadersEnd, `total` = mốc kết thúc − mốc request. Kết nối tái dùng ⇒ thiếu dns/connect/ssl.
- `isNavigation` = `Document` + `loaderId === requestId` + frame là frame chính (lấy bằng `Page.getFrameTree` lúc `start`, **hạn chót 1 s**; không lấy được thì bỏ điều kiện frame). ⚠ Hạn chót là bắt buộc: tab chưa từng điều hướng (tab mới trống) thì CDP giữ lệnh tới lúc điều hướng đầu bắt đầu ⇒ `start` treo vô hạn và nút ghi kẹt (đo được trong harness E2E Electron 33).
- TLS (`security`): `validFrom/validTo` là **epoch ms**.
- WebSocket: `webSocketCreated/WillSendHandshakeRequest/HandshakeResponseReceived/FrameSent/FrameReceived/FrameError/Closed`; `ts` frame là epoch ms; payload opcode 2 (nhị phân) là **base64**, còn lại là text; ring 500 frame mới nhất/entry, 64 KB/payload (`truncated`); `wsFrameCount` (trong summary) đếm cả frame đã rớt khỏi ring.

**Giới hạn:** 5000 entry/tab (rớt cũ nhất, `dropped++`); body phản hồi ≤ 5 MB, body request ≤ 1 MB (cắt theo byte gốc, `truncated` + `size` gốc); tổng ngân sách body **256 MB toàn app** — vượt thì đẩy body CŨ NHẤT ra (entry còn, `responseBody` undefined, `bodyEvicted: true`, `hasResponseBody: false`). Body giữ nguyên như nhận (base64 khi nhị phân). _Giới hạn của Chromium:_ `Network.enable` của browser_tool đặt `maxResourceBufferSize` 8 MB nên response lớn hơn không lấy được body (entry vẫn đủ metadata).

**IPC** (`ipcMain.handle`, mọi lệnh qua `this.tab(tabId, scope)`: scope sai/tab lạ ⇒ `no such browser tab`, không phân biệt hai ca; `tabId` bắt buộc nên không bao giờ tự tạo tab): `browser:capture:start|stop|clear|state|list|get|exportHar|replay|openWindow`. `list(sinceSeq)` chỉ trả entry MỚI (`seq > sinceSeq`), entry cũ đổi trạng thái đến qua sự kiện. Bridge: `window.awog.browser.capture.*` + `onEvent` (preload dùng `fanOut`).

**HAR 1.2** (`buildHar`): `request/response.cookies` parse từ `Cookie`/`Set-Cookie`, `queryString`, `postData`, `content.text` (+ `encoding: 'base64'` khi nhị phân), `timings` (`-1` khi thiếu; `time` = tổng phần ≥ 0 không cộng `ssl` vì đã nằm trong `connect`), `serverIPAddress`, `_resourceType`, `_webSocketMessages`. Hộp thoại lưu do **main** mở (`dialog.showSaveDialog`), file ghi `0600` (chứa cookie/token thật). `ids` rỗng = tất cả.

**Replay** (`browser:capture:replay`): `net.request` qua session của partition của tab (proxy của profile áp dụng), `credentials: 'omit'` + `useSessionCookies: false` ⇒ cookie CHỈ lấy từ header người dùng đã sửa, không tự thêm từ jar. URL (và MỖI hop redirect khi `followRedirects`) phải qua `hostBlocked` như điều hướng; chỉ http(s); phương thức kiểm charset token, cấm `CONNECT`; tối đa 10 hop; timeout 30 s; body phản hồi ≤ 5 MB. Bỏ `Host`/`Content-Length`/`Connection`/`Transfer-Encoding` (Chromium tự quản); header trùng tên bị gộp (`setHeader` chỉ giữ một giá trị; `Cookie` nối bằng `; `, còn lại `, `); Chromium vẫn tự thêm vài header (vd `Accept-Encoding`). Khi `followRedirects: false` header 3xx lấy từ sự kiện `redirect` (dạng record ⇒ mất thứ tự).

**Cửa sổ inspector** (`openWindow`): MỘT cửa sổ/tab, route `network-capture?tabId=…&scope=…` qua `loadAppRoute` + `applyNavigationGuards`, cùng preload + contextIsolation + sandbox, tiêu đề `Network · <host>`; đóng cùng tab.

**Bảo mật:** dữ liệu capture (cookie, token, body) chỉ nằm trong bộ nhớ main + renderer của inspector; KHÔNG gửi sidecar, KHÔNG có tool/`hostRequest` cho agent, KHÔNG log (chỉ log số entry khi xuất HAR), KHÔNG ghi đĩa trừ file HAR người dùng chọn. Không đụng allowlist remote gateway. Payload IPC là L1: `tabId`/`id`/`ids`/`request` được kiểm lại ở main.

**Kiểm chứng:** `electron/src/__tests__/browser-capture-core.test.ts` (15 ca: ánh xạ, redirect, ExtraInfo trước/sau, timing, ring, ngân sách, WS, HAR) + harness Electron thật (server HTTP cục bộ + `ws`) — start → nạp trang → kiểm Cookie/Set-Cookie thô, body POST/JSON, chuỗi redirect, ảnh base64, WebSocket, HAR ghi ra file, replay, inspector window, dọn khi đóng tab. **Smoke E2E** (Electron thật + `BrowserController` thật + preload thật + trang Nuxt `/network-capture` thật, engine stub): tạo tab trống → `capture.start` + `openWindow` từ một renderer có preload → nạp trang thử (Set-Cookie 2 dòng, `fetch` POST JSON có JWT) → inspector hiện 2 dòng (GET `/` Document, POST `/api/login` Fetch), bấm dòng POST ra header request có `Cookie: sid=abc123; pref=1` (gồm cả cookie HttpOnly), tiêu đề cửa sổ `Network · 127.0.0.1:<port>`.

## Phát hiện bảo mật + định dạng xuất (utils)

Hai module thuần (không I/O, không request) ở `apps/desktop/ui-next/utils/`: `capture-export.ts` và `capture-findings.ts`. Test: `utils/__tests__/capture-{export,findings}.test.mjs` (`pnpm test:unit`).

### Định dạng xuất (`capture-export.ts`)

- **`toCurl`** — bash: bọc nháy đơn, `'` → `'\''`; cmd: kiểu Chrome (`\`→`\\`, `"`→`\"`, `^` trước `& | < > ^ " %`, xuống dòng → `^`+2 LF, bọc `^"…^"`). Giữ thứ tự + header trùng; bỏ `Content-Length` (curl tự tính) và `Accept-Encoding` (thay bằng `--compressed`); bỏ `Host` khi trùng URL; header giả HTTP/2 (`:authority`…) bị loại. `-X` chỉ khi curl không tự suy ra (GET trơn / POST có body thì không); HEAD → `-I`. Body text → `--data-raw`; body base64 → `printf %s '<b64>' | base64 -d | curl … --data-binary @-` (cmd: ghi chú `REM` + `@body.bin`).
- **`toFetch`** — `headers` là MẢNG cặp (giữ trùng tên/thứ tự); bỏ header trình duyệt cấm đặt (Cookie, Host, User-Agent, Origin, Referer, `sec-*`…) kèm comment liệt kê; luôn `credentials: 'include'` (dùng cookie của trình duyệt đang chạy chứ không phải Cookie đã bắt); body base64 → `Uint8Array.from(atob(...))`.
- **`toRawRequest` / `toRawResponse`** — `\r\n`; HTTP/2 được hạ về HTTP/1.1 (`:method`/`:path` → request line, `:authority` → `Host:`, `:status` → status line, nhãn `HTTP/2` ở response).
- **`parseRawRequest`** — chịu `\n`/`\r\n`, absolute-form, thiếu Host (dùng `base`), `Host:` thắng `base`; body giữ nguyên sau dòng trống đầu tiên.
- Khác: `decodeJwt` (base64url + padding, `expired` chỉ có khi có `exp`), `findJwts`, `parseCookieHeader`, `parseSetCookie` (thuộc tính viết thường: `max-age`, `expires`, `samesite`, `partitioned`…), `queryParams`, `prettyBody` (JSON 2 space; form → `k = v`; html/xml/text giữ nguyên; ảnh raster png/jpeg/gif/webp/bmp/ico → data URL; **svg luôn là text**; nhị phân → hexdump 4 KB).
- Mọi đầu ra là chuỗi thuần; UI hiển thị bằng text node, không `v-html`.

### Danh mục findings (`capture-findings.ts`)

`analyzeEntry(e, {pageScheme})` / `analyzeAll(entries)` (dedupe theo `(id, host)`, sắp high→info, `pageScheme` suy từ request điều hướng gần nhất của tab). `title`/`detail` = khoá i18n `capture.finding.<id>.title|detail`; `params` luôn có `host`.

| id                           | Mức                                                   | Điều kiện                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cookieNoHttpOnly`           | medium                                                | Set-Cookie không HttpOnly                                                                                                                             |
| `cookieNoSecure`             | medium                                                | Set-Cookie không Secure (chỉ khi response là https/wss)                                                                                               |
| `cookieNoSameSite`           | low                                                   | Set-Cookie không SameSite                                                                                                                             |
| `cookieSameSiteNoneInsecure` | high                                                  | `SameSite=None` không Secure                                                                                                                          |
| `missingCsp`                 | medium                                                | Document HTML 2xx thiếu CSP                                                                                                                           |
| `missingHsts`                | medium                                                | như trên, chỉ https, thiếu HSTS                                                                                                                       |
| `missingXcto`                | low                                                   | thiếu `X-Content-Type-Options`                                                                                                                        |
| `missingFrameProtection`     | low                                                   | thiếu cả `X-Frame-Options` lẫn CSP `frame-ancestors`                                                                                                  |
| `missingReferrerPolicy`      | info                                                  | thiếu `Referrer-Policy`                                                                                                                               |
| `corsWildcardCredentials`    | high                                                  | ACAO `*` + ACAC `true`                                                                                                                                |
| `corsReflectOrigin`          | high / low                                            | ACAO = Origin của request (khác origin của chính nó); high nếu có credentials                                                                         |
| `mixedContent`               | high (script/css/xhr/fetch/ws/doc) / medium (còn lại) | subresource http/ws trên trang https                                                                                                                  |
| `credentialsInUrl`           | medium                                                | key query khớp token/access*token/api_key/apikey/key/secret/password/session/sig/signature (ranh giới `* . -`, không phân biệt hoa thường) có giá trị |
| `userinfoInUrl`              | high                                                  | `user:pass@` trong URL                                                                                                                                |
| `jwtAlgNone`                 | high                                                  | JWT `alg: none` trong URL/header/body                                                                                                                 |
| `jwtExpired`                 | low                                                   | JWT có `exp` đã qua                                                                                                                                   |
| `basicAuthOverHttp`          | high                                                  | `Authorization: Basic` trên http/ws                                                                                                                   |
| `serverVersion`              | low                                                   | `Server` có chữ số                                                                                                                                    |
| `poweredBy`                  | low                                                   | có `X-Powered-By`                                                                                                                                     |
| `aspnetVersion`              | low                                                   | `X-AspNet-Version` / `X-AspNetMvc-Version`                                                                                                            |
| `verboseError`               | medium                                                | body có `Traceback (most recent call last)`, `at java.`, `Exception in thread`, `SQLSTATE`, `ORA-\d{5}`                                               |
| `directoryListing`           | medium                                                | body có `<title>Index of /`                                                                                                                           |
| `cacheNoStore`               | low                                                   | response 2xx đặt cookie hoặc request có Authorization mà thiếu `Cache-Control: no-store`                                                              |

Giới hạn: chỉ quét 256 KB đầu của body text (không quét body base64); phát hiện thụ động trên một request nên `corsReflectOrigin` chỉ là gợi ý (phản chiếu thật cần thử nhiều Origin trong repeater); evidence không chứa giá trị cookie/mật khẩu (chỉ tên/khoá, JWT cắt 24 ký tự).

## Giao diện (UI)

### Nút trên thanh điều hướng

`BrowserNavBar.vue` (cụm `.bch-urltools`, cạnh đồng hồ tải / globe / ☆) có nút **Network capture** (icon `act`). Tắt: chỉ icon. Đang ghi: icon đỏ + chấm đỏ + số request sống. Bấm = **bật ghi nếu đang tắt rồi mở/focus cửa sổ inspector** của tab. State (`recording`, `count`) do `composables/useCaptureIndicator.ts` giữ — chỉ `CaptureState`, không có dữ liệu request; số đếm làm mới theo nhịp 400 ms sau mỗi upsert thay vì một IPC mỗi request.

### Cửa sổ inspector (`pages/network-capture.vue`)

Route `network-capture?tabId=<id>&scope=<scope>`, layout `false`. State nằm hết trong `composables/useNetworkCapture.ts` (page-controller) và được `provide`/`inject` xuống `components/capture/*`; style dùng chung ở khối `<style>` không-scoped của trang (prefix `cap-`).

Bốn view (thanh trên cùng): **Request** · **Repeater** · **Phát hiện** (Findings) · **Bảo mật** (Security). Chỉ báo "Chỉ trên máy" nhắc dữ liệu không rời app.

**Request**

- Toolbar: Ghi/Dừng, Xoá, ô lọc (`regex:<mẫu>` = RegExp không phân biệt hoa/thường; regex hỏng → viền đỏ và _không lọc_), nút **Nội dung** (tìm cả header + body: lười, tải từng entry qua `get` với 6 luồng song song, huỷ được khi đổi bộ lọc), chọn method, **Site này** (cùng registrable domain với trang — lấy từ navigation request mới nhất, dự phòng URL tab), đếm `hiện / tổng` + số `dropped`, xuất HAR (tất cả / đang lọc). Chip loại (Tất cả/Doc/Fetch-XHR/JS/CSS/Ảnh/Media/Font/WS/Khác, chọn nhiều) và chip status (2xx/3xx/4xx/5xx/Lỗi). Logic lọc/sắp xếp thuần ở `utils/capture-filter.ts`.
- Bảng ảo hoá (`CaptureTable.vue`): dòng cao cố định 24 px, chỉ dựng cửa sổ nhìn thấy (+8 dòng đệm) trên thân cao cố định ⇒ 5000 dòng cuộn mượt (đo: 4999 dòng, DOM chỉ ~38 `.cap-row-r`). Cột `# / Method / Status / Host / Path / Loại / Dung lượng / Thời gian / Bắt đầu`, bấm tiêu đề để sắp (bấm lại đảo chiều), ↑/↓/PageUp/PageDown chọn dòng. Mặc định sắp theo `#` và tự bám đáy khi đang ở đáy (kiểu `tail -f`). Màu status dùng token `--green/--blue/--amber/--danger`.
- Pane chi tiết kéo đổi bề rộng được (tay nắm 5 px, ←/→ chỉnh bằng phím, nhớ ở `localStorage awog.captureDetailWidth`). Hàng hành động: Chép URL / cURL (bash) / cURL (cmd) / fetch / request thô / response thô và **Repeater**. Tab: **Header** (General + header request/response, chuyển _Thô_ dùng `requestHeadersText`/`responseHeadersText`), **Payload** (bảng query + body), **Response** (Đẹp/Thô/Hex; ảnh raster xem trước), **Cookie** (gửi từ `Cookie`, nhận từ từng `Set-Cookie` với cột Domain/Path/Expires/HttpOnly/Secure/SameSite — thiếu thì tô đỏ, `SameSite=None` không `Secure` cũng đỏ; cookie bị chặn), **Thời gian** (waterfall), **Bảo mật** (TLS), **Nguồn gọi** (initiator + stack), **WebSocket** (chỉ khi là WS: bảng frame có mũi tên ↑↓, payload JSON pretty, opcode 2 hiện base64 + số byte) và **JWT** (chỉ khi tìm thấy: header/payload/chữ ký đã giải mã, nhãn `đã hết hạn` / `alg: none`, nguồn token).
- Body luôn render **dạng text** (không `v-html`): HTML hiện là mã nguồn đã escape; ảnh chỉ qua `data:` URL cho raster png/jpeg/gif/webp/bmp/ico (không SVG). Hiển thị cắt ở 200 000 ký tự (có nút "Hiện toàn bộ"), hex dump cắt ở 64 KB.

**Repeater** — editor request thô (`<textarea>` `resize-y`, không dùng Monaco: không cần model/ngôn ngữ), nút Gửi (⌘/Ctrl+Enter), tuỳ chọn "Theo redirect" (mặc định tắt), panel response (status, header, body Đẹp/Thô/Hex, thời gian) và lịch sử các lần gửi trong bộ nhớ (cap 50, bấm để nạp lại). "Gửi sang Repeater" từ chi tiết dùng `toRawRequest`; gửi dùng `parseRawRequest` với `{scheme, host}` của request gốc. Cookie **không** tự thêm.

**Phát hiện** — `analyzeAll` trên toàn bộ entry (tải đủ entry qua cache, phân tích lại có trễ 1,2 s khi có request mới), nhóm theo mức độ Cao/Trung bình/Thấp/Thông tin; bấm một dòng để nhảy tới request đó. Chuỗi `title`/`detail` là key i18n `capture.finding.<id>.*` + `params`.

**Bảo mật** — `components/capture/CapturePentest.vue`, dùng lại entry + findings của `runAnalysis` (không tải lần hai; `secEntries` trong composable). Ba khối:

- **Checklist OWASP Top 10 (2021)**: `evaluateOwasp(entries, findings)` (`utils/capture-owasp.ts`) gom finding theo category A01–A10; trạng thái `clean` (đã kiểm, không thấy) / `suspect` (có bằng chứng) / `manual` (phải kiểm tay — kèm gợi ý `capture.sec.guide.*`). Mở rộng dòng = danh sách bằng chứng; bấm nhảy tới request (`showEntry`) hoặc finding (`showFinding`).
- **Công nghệ nhận diện**: `fingerprintTech(entries)` (`utils/capture-fingerprint.ts`) nhận Server/X-Powered-By/cookie phiên/meta generator → tên + phiên bản. Mỗi dòng có nút tra NVD / Exploit-DB / GitHub advisories (mở link ngoài qua `openExternally` — cửa sổ inspector không mount LinkOpenHost nên không dùng popover "mở trong app") và nút **Tra NVD** = request duy nhất ra ngoài: `fetch(nvdApiUrl(tên+phiên bản))` → `parseNvdJson` → danh sách CVE inline (id link tới nvd.nist.gov, badge severity theo điểm). Chỉ chạy khi người dùng bấm — đúng nguyên tắc "không gọi mạng tự động".
- **Quét bảo mật chủ động** (`utils/capture-scan.ts` + `composables/useCaptureScanner.ts`): nút "Quét ngay" (confirm trước — nói rõ sẽ GỬI request biến đổi tới host, chỉ cho hệ thống được phép kiểm thử) replay probe qua `browser:capture:replay` của chính tab theo 10 kịch bản `capture.sec.scenario.*` (sqli-error/time, xss, ssti, lfi, redirect, cmdi, crlf, xxe, cors-reflect), scope = site đang xem hoặc mọi host; progress done/total + nút Dừng; `ScanFinding` nhóm theo severity, bấm nhảy tới entry gốc. Kết quả scan merge vào checklist OWASP ở lớp UI (`evaluateOwasp` giữ nguyên). Request replay được làm sạch header trước: bỏ `sec-fetch-*`/`x-client-data` (Chromium tự quản — giữ lại làm `net.request` phá `ERR_INVALID_ARGUMENT`, kèm `Origin` thành `ERR_FAILED` — đo trên Electron 33) + pseudo-header/transport header + control char trong value; mutation không đổi gì so với baseline thì bỏ. Lỗi probe dedupe `×N` kèm `METHOD URL [scenario]`; ≥12 lỗi transport liên tiếp → dừng sớm + `report.blocked` (WAF/CDN chặn thảm). Mọi probe ghi một dòng `ScanProbeResult` (scenario, request đã gửi, status/ms/bytes, hit severity) → tab Quét hiển thị bảng chi tiết với nút mở request gốc + chevron xem request/response đã bắn. Payload LFI dùng dạng `%2e%2e`/`%2f` vì URL parser của Chromium chuẩn hoá `../` khỏi path trước khi gửi. View Bảo mật chia 4 sub-tab (Quét / OWASP Top 10 / Công nghệ & CVE / Payload) theo idiom underline của detail pane.
- **Gửi agent phân tích**: `cap.sendToAgent(scanFindings)` (cũng có ở view Phát hiện) — `sessions.create()` + `sendMessage` với prompt tổng hợp passive + active findings (cap 30 dòng/nhóm), rồi `openSessionWindow` mở phiên ra cửa sổ popout riêng. Đường duy nhất đưa dữ liệu capture tới agent, luôn do người dùng bấm.

### Dữ liệu ở renderer

`CaptureEntry` đầy đủ chỉ được lấy khi cần (chọn dòng / tìm trong body / findings) và cache theo _danh tính_ của `CaptureSummary`: một upsert thay summary ⇒ cache hết hạn tự động (pending → done, thêm frame WS…). Không có gì ghi xuống đĩa trừ HAR người dùng tự lưu.

### i18n

`i18n/locales/{en,vi}/capture.json` (khoá phẳng `capture.*`), gồm cả khối `capture.finding.*` do slice Utils cấp.
