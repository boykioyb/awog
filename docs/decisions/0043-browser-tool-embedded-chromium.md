# 0043 — browser_tool (Chromium nhúng) + reverse host-request channel

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-16
- **Người quyết định:** AWOG core (theo yêu cầu user)

## Bối cảnh

User muốn agent của AWOG **đọc/tương tác web như Craft Agents** — Craft expose một `browser_tool` lái trình duyệt Chromium nhúng (CDP) để navigate/click/fill/screenshot/extract. Đối chiếu kiến trúc:

- Craft chạy theo mô hình **dual-backend** (Claude Agent SDK + Pi) và agent dạng **subprocess**; web tool của nó là một Chromium pane trong Electron điều khiển qua RPC/CDP.
- AWOG (theo [ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md)) chạy **Pi in-process** trong sidecar. Khảo sát cho thấy "full clone" subprocess là **thừa** (sidecar đã là tiến trình riêng), và đẩy Pi vào subprocess sẽ **re-lộ OAuth token** ra tiến trình thứ 3 → yếu invariant #1. Vậy ta KHÔNG clone subprocess; chỉ lấy phần có giá trị: **browser_tool**.

Vấn đề kỹ thuật: tool chạy trong **sidecar** (tiến trình Node, không có Chromium); Chromium chỉ tồn tại ở **Electron main**. IPC hiện tại một chiều cho request (renderer→main→sidecar) + sidecar→main chỉ **event**. **Chưa có đường sidecar→main request/await reply.**

## Quyết định

1. **Thêm kênh RPC ngược sidecar→main** trên carrier stdio sẵn có, tách namespace với forward request:
   - sidecar→main (stdout): `{ method:'host-request', params:{ rid, hostMethod, hostParams } }`
   - main→sidecar (stdin): `{ method:'host-response', params:{ rid, result|error } }`
   - `rid` là counter riêng của sidecar; vì mang `method` (không có top-level `id`) nên không đụng nhánh `id`-number của `engine.onLine` lẫn `isJsonRpcRequest`. Host **luôn reply** (method lạ → `-32601`, handler throw → error); sidecar `hostRequest` có **timeout** → không treo turn.
   - Files: [transport/stdio.ts](../../apps/desktop/sidecar/src/transport/stdio.ts) (`hostRequest`/`resolveHostResponse`), [index.ts](../../apps/desktop/sidecar/src/index.ts) (chặn `host-response`), [electron/engine.ts](../../apps/desktop/electron/src/engine.ts) (`registerHostHandler` + `handleHostRequest`).

2. **BrowserController ở Electron main** ([electron/browser.ts](../../apps/desktop/electron/src/browser.ts)): 1 `BrowserWindow` ẩn lazy, partition riêng `persist:awog-browser` (cô lập cookie khỏi app). 5 lệnh dùng **webContents API cao cấp** (KHÔNG raw CDP): `loadURL` / `executeJavaScript` (click/fill/extract, chuỗi nhúng qua `JSON.stringify`) / `capturePage().toPNG()`. Guard `will-navigate` + `setWindowOpenHandler('deny')`.

3. **browser_tool AgentTool ở sidecar** ([runtime/tools/browser-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/browser-tool.ts)): schema action-discriminated, route qua `hostRequest('browser.<action>')`. Navigate qua `assertSafeUrl` (SSRF DNS-resolving, chia sẻ [ssrf.ts](../../apps/desktop/sidecar/src/runtime/tools/ssrf.ts) với WebFetch). Screenshot **ghi file** `<cwd>/.awog/screenshots/*.png` qua `assertInsideWorkspace`, chỉ trả path (PNG không vào tool text). Mutating action (navigate/click/fill) bị **permission gate**; screenshot/extract read-only.

4. **UI surface**: tray item "Toggle browser window". Mặc định ẩn (không bật cửa sổ bất ngờ).

5. **KHÔNG** đi subprocess pi-coding-agent, **KHÔNG** dual claude-agent-sdk, **KHÔNG** AgentBackend abstraction (YAGNI — chưa có backend thứ 2). Token vẫn in-process (invariant #1 nguyên vẹn).

## Phương án đã cân nhắc

- **Full clone Craft (subprocess + dual backend + browser)** — thừa cô lập, re-lộ token, phải tự dựng protocol JSONL ~30 message; `@mariozechner/pi-coding-agent` đã deprecated. Từ chối.
- **Raw CDP (`webContents.debugger`)** cho lệnh — cần cho 40+ lệnh parity (input dispatch, network), nhưng lean set chỉ cần `loadURL`/`executeJavaScript`/`capturePage`. Hoãn CDP tới khi cần parity đầy đủ.
- **`<webview>` / WebContentsView trong renderer** — đẩy logic lái browser vào renderer sandbox, khó capture/lifecycle. Driving từ main gọn + auditable hơn.
- **Renderer→main IPC trực tiếp cho show/hide** thay vì sidecar method relay — đã chọn (tray gọi `browser.show/hide` trực tiếp ở main); bỏ method relay sidecar (thừa round-trip).

## Hệ quả

- **Tích cực:** agent đọc/tương tác web thật qua Chromium; token in-process nguyên vẹn; zero dependency mới (webContents + node dns/crypto built-in); cùng SSRF guard với WebFetch.
- **Tiêu cực / Trade-off:**
  - Thêm một chiều IPC mới (sidecar→main) — phải giữ framing chặt để không vỡ luồng `event`/response (đã tách bằng discriminator `host-request`/`host-response`).
  - Lean set thiếu parity với Craft (không input-dispatch thật, không network monitor, không canvas pixel-coords).
  - **TOCTOU DNS** còn hở như WebFetch (chấp nhận theo threat model desktop); `will-navigate` guard đóng lỗ click→host nội bộ.
- **Việc cần làm tiếp:** verify e2e trong app đang chạy (round-trip `host-request`); xác nhận tên `browser_tool` pass-through dưới OAuth (Pi không canonicalize tên lạ); infosec review; cân nhắc CDP nếu cần parity.

## Tham chiếu

- [ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md) — Pi in-process runtime
- [ADR 0042](0042-webfetch-tool-ssrf-guarded.md) — WebFetch + `assertSafeUrl` (tái dùng)
- [security.md](../../.claude/rules/security.md) — invariant #1 (token), #2 (path), #7 (SSRF)
- [docs/features/browser-tool.md](../features/browser-tool.md) — spec chi tiết

---

## Đính chính 2026-09-07 — nâng cấp vòng 2

ADR này giữ nguyên (Accepted); mục dưới **bổ sung**, không viết lại lịch sử. Ba chỗ trong phần "Quyết định" đã bị vượt qua và ghi rõ ở đây.

**1. "5 lệnh" → 14.** Thêm `snapshot`, `console`, `network`, `network_body`, `viewport`, `tabs`, `tab_new`, `tab_select`, `tab_close`; `click`/`fill` nhận thêm `ref`.

Lý do đổi: bộ lệnh gọn buộc model "nhìn" trang bằng **screenshot** — đắt token và model không đọc chính xác chữ trên ảnh — hoặc bằng `extract` mode `dom`, tức outerHTML ngập rác. `snapshot` trả **cây accessibility rút gọn**, mỗi phần tử tương tác gắn một `ref_N` (stamp `data-awog-ref` lên chính DOM node, xoá stamp cũ trước mỗi lần chụp). `click`/`fill` gọi theo ref thay vì bịa CSS selector. Đây là điều kiện để vòng "chụp → bấm → chụp lại" chạy ổn định, và là thay đổi có giá trị nhất của đợt.

**2. "KHÔNG raw CDP" → có, cho đúng hai việc.** ADR gốc hoãn CDP tới khi cần parity. Hai yêu cầu mới chạm đúng ranh giới đó: **ghi network kèm response body** và **giả lập thiết bị**. `webContents` không cấp cả hai (`session.webRequest` có metadata nhưng không có body; `setContentSize` không đổi DPR/touch/UA). Nên mỗi tab attach `webContents.debugger` lúc tạo và bật `Network.enable` + dùng `Emulation.*`. Phần còn lại (navigate/click/fill/extract/snapshot/screenshot) **vẫn** đi `loadURL`/`executeJavaScript`/`capturePage` như quyết định gốc — không có input-dispatch qua CDP, không có toạ độ pixel.

Attach fail (user mở DevTools cho cửa sổ đó) là **fail mềm**: tab vẫn duyệt, `network` báo unavailable, `viewport` chỉ resize.

**3. "1 BrowserWindow ẩn" → một cửa sổ mỗi tab (cap 8), chung partition.** Đã cân nhắc `WebContentsView` con trong một cửa sổ shell và **từ chối**: bề mặt này headless mặc định + lái hoàn toàn bằng lệnh, nên thanh tab chỉ là chrome không ai vẽ; đổi lại phải xoay `setVisible`/bounds và làm `capturePage` trên view ẩn thành rủi ro. Một cửa sổ mỗi tab giữ nguyên đường capture đang chạy tốt và giữ console/network/debugger per-webContents. Đổi lại: nhiều cửa sổ OS khi user bật hiện — chấp nhận, vì mặc định ẩn.

## Bảo mật bổ sung

- **Prompt injection (mới).** Bản gốc trả `extract` **thô, không hàng rào** — trang web là L1 hoàn toàn không tin và nội dung đi thẳng vào prompt. Nay mọi nội dung trang (`snapshot`/`extract`/`console`/`network`/`network_body`) được bọc trong hàng rào mang **nonce sinh mới mỗi lần gọi**, cùng khuôn `read-terminal-tool.ts`: trang không đoán được nonce nên không tự đóng hàng rào để viết chỉ thị ở ngoài. Ranh giới vẽ theo **quyền kiểm soát**, không theo "đây có phải thân trang không": `<title>`, URL cuối sau redirect và header response cũng do trang quyết định nên cũng nằm trong hàng rào; header của kết quả chỉ mang dữ kiện do tool sinh. `click` do đó **không** echo nhãn phần tử.
- **Rò bí mật (mới).** `network` là bề mặt xuất khẩu token nếu để nguyên. Header credential bị **loại hẳn ở Electron main** trước khi bản ghi rời tiến trình đó; phần còn lại đi qua `redactString` (`sessions/redact.ts`). Số header bị giấu được báo lại để model không tưởng request đi không auth.
- **SSRF không đổi:** `navigate` và `tab_new` cùng qua `assertSafeUrl`; main vẫn re-check literal host + `will-navigate`.
- **⚠ Hở còn lại:** `isGatedTool` so tên bằng `===` nên tên bắc cầu `mcp__awogbrowser__browser_tool` **không bị gate**. `isBrowserToolName` đã export sẵn; permission.ts cần một dòng đúng khuôn `isWikiMutatingTool`/`sshToolName`. Chưa sửa vì nằm ngoài phạm vi thay đổi này.

## Bổ sung: nhánh Claude SDK

ADR gốc ra đời khi AWOG còn "Pi single runtime". [ADR 0058](0058-claude-agent-sdk-vs-pi-runtime-revisit.md) đã đảo điều đó: `provider === 'anthropic'` chạy `@anthropic-ai/claude-agent-sdk`. Hệ quả không ai ghi lại: **đổi sang tài khoản Anthropic thì mất luôn browser_tool** — agent còn WebFetch (HTML thô, không chạy JS). Một năng lực biến mất khi đổi nhà cung cấp thì với người dùng là app hỏng.

Nay tool được bắc cầu bằng in-process SDK MCP server khoá `awogbrowser` ([browser-sdk-server.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/browser-sdk-server.ts)), handler gọi **đúng** `runBrowserAction` mà Pi AgentTool gọi — nên SSRF, hàng rào nonce, redact và mọi cap là một bản duy nhất. Theo tiền lệ `awogwiki`/`awogssh`/`awogsurfaces` ([ADR 0060](0060-connections-adopt-craft-sources-model.md) D-8 cấm `createSdkMcpServer` trên nhánh Pi, không cấm nhánh này). Tên tool **không** bắt đầu bằng `mcp_` (tiền tố Anthropic dành riêng — `mcp_describe`/`mcp_call` từng làm lượt OAuth trả 400).
