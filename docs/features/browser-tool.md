# Feature: browser_tool (Chromium nhúng)

Cho phép agent lái một trình duyệt Chromium nhúng để đọc/tương tác web. Bộ lệnh gọn: `navigate / click / fill / screenshot / extract`. Quyết định kiến trúc: [ADR 0043](../decisions/0043-browser-tool-embedded-chromium.md).

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

| action | params | Hành vi | Result (text) |
|---|---|---|---|
| `navigate` | `url` | `loadURL` (SSRF-guarded) | `Navigated to <url> — "<title>"` |
| `click` | `selector` | `querySelector(sel).click()` | `Clicked <sel>` / `No element matched <sel>` |
| `fill` | `selector`, `value` | set `.value` + dispatch `input`/`change` | `Filled <sel>` / `No element matched` |
| `extract` | `mode?` (text\|dom), `selector?` | `innerText` / `outerHTML` (cap 200KB→50k) | nội dung |
| `screenshot` | — | `capturePage().toPNG()` | ghi `<cwd>/.awog/screenshots/*.png`, trả path |

- Chuỗi `selector`/`value` nhúng vào `executeJavaScript` qua `JSON.stringify` (chống JS injection).
- Screenshot trả **đường dẫn file** (PNG không vào tool text); không có cwd (task/subagent thiếu project) → trả note.

## Cửa sổ trình duyệt

- 1 `BrowserWindow` ẩn, lazy (tạo ở lệnh đầu), partition riêng `persist:awog-browser` (cô lập cookie khỏi app — invariant #1).
- `setWindowOpenHandler('deny')` + `will-navigate` guard (chặn click→host nội bộ).
- Hiện/ẩn qua tray item **"Toggle browser window"**. Mặc định ẩn.
- `before-quit` → `browser.close()`; window bị destroy → tạo lại ở lệnh sau.

## Bảo mật

- **SSRF (invariant #7):** `navigate` qua `assertSafeUrl` ([ssrf.ts](../../apps/desktop/sidecar/src/runtime/tools/ssrf.ts), chia sẻ với WebFetch): protocol http/https + hostname literal + **DNS resolve re-check**. Main re-check literal host (defense-in-depth) + `will-navigate` guard.
- **Path (invariant #2):** screenshot qua `assertInsideWorkspace`.
- **Token (invariant #1):** browser_tool không chạm token; partition riêng.
- **Permission:** `navigate/click/fill` (mutating) bị gate theo mode (`plan` chặn, `ask` prompt, `execute` no-gate); `screenshot/extract` (read-only) không gate. Logic ở [permission.ts](../../apps/desktop/sidecar/src/runtime/permission.ts) `isGatedTool(name, args)` + `isMutatingBrowserAction`.

## File chạm

| File | Thay đổi |
|---|---|
| [electron/src/browser.ts](../../apps/desktop/electron/src/browser.ts) | **Mới** — BrowserController + `registerBrowserHostHandlers` + will-navigate guard |
| [electron/src/engine.ts](../../apps/desktop/electron/src/engine.ts) | `registerHostHandler` + nhánh `host-request` + `handleHostRequest` |
| [electron/src/main.ts](../../apps/desktop/electron/src/main.ts) | `registerBrowserHostHandlers()` + `browser.close()` + tray toggle |
| [sidecar/src/transport/stdio.ts](../../apps/desktop/sidecar/src/transport/stdio.ts) | `hostRequest` + `resolveHostResponse` + timeout |
| [sidecar/src/index.ts](../../apps/desktop/sidecar/src/index.ts) | chặn `host-response` trước forward-request guard |
| [sidecar/src/runtime/tools/browser-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/browser-tool.ts) | **Mới** — `createBrowserTool` + `BROWSER_TOOL_NAME` + `isMutatingBrowserAction` |
| [sidecar/src/runtime/tools/ssrf.ts](../../apps/desktop/sidecar/src/runtime/tools/ssrf.ts) | **Mới** — `assertSafeUrl` chia sẻ (lift từ web-fetch-tool.ts) |
| [sidecar/src/runtime/tools/index.ts](../../apps/desktop/sidecar/src/runtime/tools/index.ts) | đăng ký browser_tool + MultiEdit + Notebook |
| [sidecar/src/runtime/permission.ts](../../apps/desktop/sidecar/src/runtime/permission.ts) | gate mutating browser action |
| [sidecar/src/sessions/step-mapper.ts](../../apps/desktop/sidecar/src/sessions/step-mapper.ts) + tasks/trace-mapper.ts | map/label browser_tool + NotebookRead |

## Tool built-in vá kèm (parity Claude Code)

Cùng đợt: `MultiEdit` ([fs-tools.ts](../../apps/desktop/sidecar/src/runtime/tools/fs-tools.ts)), `NotebookEdit`/`NotebookRead` ([notebook-tools.ts](../../apps/desktop/sidecar/src/runtime/tools/notebook-tools.ts)) — tất cả in-process, gate write tools. `WebSearch` vẫn stub (out of scope đợt này).
