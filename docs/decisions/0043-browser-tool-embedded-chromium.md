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
