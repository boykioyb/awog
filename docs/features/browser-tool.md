# Feature: browser_tool (Chromium nhúng)

Cho phép agent lái một trình duyệt Chromium nhúng để đọc/tương tác web. Quyết định kiến trúc: [ADR 0043](../decisions/0043-browser-tool-embedded-chromium.md) (+ [mục đính chính 2026-09-07](../decisions/0043-browser-tool-embedded-chromium.md#đính-chính-2026-09-07--nâng-cấp-vòng-2)).

**Vòng 2 (2026-09-07)** mở rộng từ 5 lệnh lên 14, thêm CDP cho hai việc `webContents` không làm được (ghi network có body, giả lập thiết bị), và **bắc tool sang nhánh Claude SDK**. Thay đổi có giá trị nhất là `snapshot`: model đọc trang bằng **cây accessibility có `ref_N`** thay vì bằng ảnh chụp.

## Luồng

```
Agent (sidecar, Pi in-process)
  → browser_tool.execute(action, …)
    → hostRequest('browser.<action>', params)            transport/stdio.ts
      → stdout {method:'host-request', params:{rid,…}}
        → Electron main engine.handleHostRequest()         engine.ts
          → browser.<action>()                             electron/browser.ts
            → BrowserWindow.webContents (loadURL / executeJavaScript / capturePage)
          ← {result|error}
      ← stdin {method:'host-response', params:{rid,…}}
    ← resolveHostResponse(rid)
  ← AgentToolResult (text)
```

Kênh `host-request`/`host-response` là **chiều IPC mới** (sidecar→main request/await), tách namespace với forward request (renderer→main→sidecar) và event (sidecar→main). Host luôn reply; sidecar có timeout 30s.

## Lệnh (tham số `action`)

Mọi action nhận thêm `tabId?` — bỏ trống thì áp lên tab đang active.

| action | params | Hành vi | Result (text) |
|---|---|---|---|
| `navigate` | `url` | `loadURL` (SSRF-guarded) | `Loaded <tab>` + url/title trong hàng rào nonce |
| `snapshot` | `selector?` | cây accessibility rút gọn + stamp `data-awog-ref` | outline có `[ref_N]`, trong hàng rào nonce |
| `click` | `ref` **hoặc** `selector` | scroll-into-view + `focus()` + `.click()` | `Clicked ref_7` / not-found (isError) |
| `fill` | `ref`\|`selector`, `value` | set `.value` (hoặc `textContent` nếu contentEditable) + dispatch `input`/`change` | `Filled ref_4` / not-found (isError) |
| `extract` | `mode?` (text\|dom), `selector?` | `innerText` / `outerHTML` (cap 200KB→50k) | nội dung, trong hàng rào nonce |
| `screenshot` | — | `capturePage().toPNG()` | ghi `<cwd>/.awog/screenshots/*.png`, trả path |
| `console` | `level?`, `limit?` | ring buffer `console-message` của trang (500 dòng) | `[seq] level file:line — text` (đã redact) |
| `network` | `filter?`, `limit?` | ring buffer CDP `Network.*` (300 request) | `<id> METHOD status mime bytes [type] url` |
| `network_body` | `requestId` | CDP `Network.getResponseBody` | header response + body (cap 20k, đã redact) |
| `viewport` | `preset?` \| `width`/`height`, `mobile?` | `setContentSize` + CDP `Emulation.*` | kích thước mới + có emulate được hay không |
| `tabs` | — | liệt kê tab | `* tab_1  <url>  "<title>"`, trong hàng rào nonce |
| `tab_new` | `url?` | mở tab mới (SSRF-guarded nếu có url) | `Opened tab_2` + url/title trong hàng rào nonce |
| `tab_select` | `tabId` | đổi tab active | `Active tab is now tab_2` |
| `tab_close` | `tabId` | đóng tab | `Closed tab_2; N tab(s) still open` |

- Chuỗi `selector`/`value`/`ref` nhúng vào `executeJavaScript` qua `JSON.stringify` (chống JS injection).
- Screenshot trả **đường dẫn file** (PNG không vào tool text); không có cwd (task/subagent thiếu project) → trả note.

### `snapshot` — cây accessibility + `ref_N`

Bản đầu buộc model "nhìn" bằng screenshot (đắt token, đọc chữ không chính xác) hoặc bằng `outerHTML` (ngập rác). `snapshot` chạy một script trong trang và trả outline thụt lề:

```
- heading "Đăng nhập" level=1
- textbox "Email" [ref_1]
- textbox "Mật khẩu" value="***" [ref_2]
- button "Tiếp tục" [ref_3]
- link "Quên mật khẩu?" href="/reset" [ref_4]
```

- **Chỉ phần tử tương tác** mới có ref (`a[href]`, `button`, `input`/`select`/`textarea`, `summary`, `contenteditable`, `[role]` tương tác, `[onclick]`, `[tabindex]`). Landmark/heading/img/text hiện ra để định vị nhưng không có ref.
- Ref được **stamp thành `data-awog-ref` trên chính DOM node**; lần snapshot sau **xoá hết stamp cũ** rồi đánh lại từ 1 — một ref không bao giờ trỏ vào hai node. Hệ quả: **ref chết sau khi trang đổi** (navigate, re-render). Mô tả tool nói rõ điều này và `click`/`fill` khi miss trả `isError` kèm lời nhắc snapshot lại.
- Đi xuyên **open shadow root** và **iframe same-origin**; cross-origin iframe bị bỏ qua (truy cập ném lỗi).
- Bỏ node ẩn (`checkVisibility`, `aria-hidden`), bỏ `script`/`style`/`svg`. `input[type=password]` in `value="***"`.
- Cap 1200 node / 60k ký tự ở main, 50k ở sidecar; vượt thì báo `TRUNCATED` và gợi ý thu hẹp bằng `selector`.

### `console` / `network`

- Console dùng event `webContents.on('console-message')` — không cần CDP.
- Network dùng **CDP `webContents.debugger`** (`Network.enable` lúc tạo tab): `requestWillBeSent` / `responseReceived` / `loadingFinished` / `loadingFailed`. Đây là thứ duy nhất lấy được **response body** (`Network.getResponseBody`). Body chỉ nằm trong buffer của CDP một thời gian → xin body của request quá cũ sẽ lỗi, đó là hành vi đúng của giao thức.
- Debugger attach **fail mềm** (ví dụ user mở DevTools cho cửa sổ đó): tab vẫn duyệt web, `network` trả "unavailable", `viewport` chỉ resize cửa sổ.

### `viewport`

Preset `mobile` (390×844 @3x, touch + UA iPhone), `tablet` (820×1180 @2x), `desktop` (1280×800), `wide` (1680×1050); hoặc `width`/`height` tuỳ ý (clamp 200–4000). Đi qua `Emulation.setDeviceMetricsOverride` + `setTouchEmulationEnabled` + `setUserAgentOverride`, và `setContentSize` để screenshot khớp.

## Cửa sổ trình duyệt & mô hình tab

**Mỗi tab = một `BrowserWindow` riêng**, ẩn mặc định, tất cả dùng chung partition `persist:awog-browser` (cookie/storage chia sẻ giữa tab như trình duyệt thật, vẫn cô lập khỏi app — invariant #1). Cap 8 tab.

Vì sao không dùng `WebContentsView` con trong một cửa sổ shell: bề mặt này **headless mặc định** và lái hoàn toàn bằng lệnh, nên thanh tab chỉ là chrome mà ta không vẽ. Một cửa sổ mỗi tab giữ `capturePage` trên bề mặt ẩn hoạt động y như cũ, giữ console/network/debugger **per-webContents** không phải xoay visibility, và đổi lại chỉ tốn một dòng `show()`/`hide()`. Nếu sau này cần UI tab thật thì đó là lúc đổi sang `WebContentsView`.

- Cửa sổ tạo lazy (ở lệnh đầu), partition riêng `persist:awog-browser`.
- `setWindowOpenHandler('deny')` + `will-navigate` guard (chặn click→host nội bộ).
- Hiện/ẩn qua tray item **"Toggle browser window"** — `show()` mở tab active, `hide()` ẩn tất cả. Mặc định ẩn.
- `before-quit` → `browser.close()` (destroy mọi tab); window bị destroy → tạo lại ở lệnh sau.

## Bảo mật

- **SSRF (invariant #7):** `navigate` qua `assertSafeUrl` ([ssrf.ts](../../apps/desktop/sidecar/src/runtime/tools/ssrf.ts), chia sẻ với WebFetch): protocol http/https + hostname literal + **DNS resolve re-check**. Main re-check literal host (defense-in-depth) + `will-navigate` guard.
- **Path (invariant #2):** screenshot qua `assertInsideWorkspace`.
- **Token (invariant #1):** browser_tool không chạm token; partition riêng.
- **Prompt injection (L1):** mọi chuỗi **do trang kiểm soát** — không chỉ thân snapshot/extract/console/network, mà cả `<title>`, URL cuối sau redirect, header response — đều nằm **TRONG** hàng rào. Header của kết quả chỉ chứa dữ kiện do tool sinh (tên tab, số node, số request, cờ truncate); nếu để `<title>` ở đó thì trang chỉ cần đặt tiêu đề là một câu lệnh và nó xuất hiện ở chỗ trông như phần đáng tin. Vì lý do đó `click` cũng **không** echo nhãn phần tử. Nội dung được bọc trong **hàng rào mang nonce sinh mới mỗi lần gọi** — cùng khuôn với [read-terminal-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/read-terminal-tool.ts). Trang không đoán được nonce nên không tự đóng hàng rào để viết "chỉ thị hệ thống" ở ngoài. Header hàng rào nói thẳng với model rằng đó là **dữ liệu**, và nếu body chứa chuỗi giả dạng thẻ hàng rào thì thêm cảnh báo injection.
- **Rò bí mật:** header credential (`Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, `X-CSRF-Token`, …) bị **loại hẳn ở Electron main** trước khi bản ghi rời tiến trình đó — không truncate, không redact, đơn giản là không đi qua ranh giới. Phần còn lại (URL có `?token=`, body JSON có `access_token`, `console.log(token)`) đi qua `redactString` của [sessions/redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts). Số header bị giấu được báo lại để model biết có thứ đã bị bỏ, không tưởng là request không có auth.
- **Permission:** `navigate/click/fill/tab_new` (mutating) bị gate theo mode (`plan` chặn, `ask` prompt, `execute` no-gate); các action đọc (snapshot/extract/screenshot/console/network/network_body/viewport/tabs/tab_select/tab_close) không gate — chúng chỉ quan sát trình duyệt của chính agent. Logic ở [permission.ts](../../apps/desktop/sidecar/src/runtime/permission.ts) `isGatedTool(name, args)` + `isMutatingBrowserAction`.
- **⚠ Hở đã biết — gate không bắt tên bắc cầu.** `isGatedTool` so `name === 'browser_tool'`, nên trên nhánh Claude SDK tên `mcp__awogbrowser__browser_tool` **không khớp** và navigate/click/fill đi qua không xin phép (kể cả plan mode). `browser-tool.ts` đã export sẵn `isBrowserToolName(name)`; permission.ts chỉ cần đổi một dòng thành `if (isBrowserToolName(name)) return isMutatingBrowserAction(args)` — đúng khuôn `isWikiMutatingTool` / `sshToolName` đang dùng cho các tool bắc cầu khác.

## Nhánh Claude SDK

Trước vòng 2, `browser_tool` chỉ có trên nhánh Pi ⇒ đổi sang tài khoản Anthropic là **mất** khả năng duyệt web (chỉ còn WebFetch: HTML thô, không chạy JS). [browser-sdk-server.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/browser-sdk-server.ts) bắc cầu bằng in-process SDK MCP server khoá `awogbrowser` → `mcp__awogbrowser__browser_tool`, handler gọi **đúng** `runBrowserAction` mà Pi gọi. Chỉ schema tham số khai hai lần (TypeBox / zod); mô tả tool dùng chung hằng `BROWSER_TOOL_DESCRIPTION`.

Tên tool của ta không bắt đầu bằng `mcp_` (tiền tố Anthropic dành riêng, custom tool dùng nó làm lượt OAuth trả 400 — repo đã dính một lần với `mcp_describe`/`mcp_call`). Namespace `mcp__` do SDK tự thêm là quy ước của chính API, không liên quan.

## File chạm

| File | Thay đổi |
|---|---|
| [electron/src/browser.ts](../../apps/desktop/electron/src/browser.ts) | **Mới** — BrowserController + `registerBrowserHostHandlers` + will-navigate guard |
| [electron/src/engine.ts](../../apps/desktop/electron/src/engine.ts) | `registerHostHandler` + nhánh `host-request` + `handleHostRequest` |
| [electron/src/main.ts](../../apps/desktop/electron/src/main.ts) | `registerBrowserHostHandlers()` + `browser.close()` + tray toggle |
| [sidecar/src/transport/stdio.ts](../../apps/desktop/sidecar/src/transport/stdio.ts) | `hostRequest` + `resolveHostResponse` + timeout |
| [sidecar/src/index.ts](../../apps/desktop/sidecar/src/index.ts) | chặn `host-response` trước forward-request guard |
| [sidecar/src/runtime/tools/browser-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/browser-tool.ts) | `runBrowserAction` (lõi dùng chung 2 runtime) + `createBrowserTool` + `BROWSER_TOOL_DESCRIPTION` + `isBrowserToolName` + `isMutatingBrowserAction` + hàng rào nonce + redact |
| [sidecar/src/runtime/claude-sdk/browser-sdk-server.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/browser-sdk-server.ts) | **Mới (vòng 2)** — cầu SDK MCP `awogbrowser` |
| [sidecar/src/runtime/claude-sdk/run-stream.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts) | gắn `[BROWSER_MCP_SERVER]` vào `allServers` |
| [sidecar/src/runtime/tools/ssrf.ts](../../apps/desktop/sidecar/src/runtime/tools/ssrf.ts) | **Mới** — `assertSafeUrl` chia sẻ (lift từ web-fetch-tool.ts) |
| [sidecar/src/runtime/tools/index.ts](../../apps/desktop/sidecar/src/runtime/tools/index.ts) | đăng ký browser_tool + MultiEdit + Notebook |
| [sidecar/src/runtime/permission.ts](../../apps/desktop/sidecar/src/runtime/permission.ts) | gate mutating browser action |
| [sidecar/src/sessions/step-mapper.ts](../../apps/desktop/sidecar/src/sessions/step-mapper.ts) + tasks/trace-mapper.ts | map/label browser_tool + NotebookRead |

## Tool built-in vá kèm (parity Claude Code)

Cùng đợt: `MultiEdit` ([fs-tools.ts](../../apps/desktop/sidecar/src/runtime/tools/fs-tools.ts)), `NotebookEdit`/`NotebookRead` ([notebook-tools.ts](../../apps/desktop/sidecar/src/runtime/tools/notebook-tools.ts)) — tất cả in-process, gate write tools. `WebSearch` vẫn stub (out of scope đợt này).
