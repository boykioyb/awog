# Feature: Thẻ xem trước trang của `browser_tool`

Khi agent mở một trang bằng trình duyệt nhúng (`browser_tool` `navigate` / `tab_new` có `url`), transcript hiện **một thẻ** ngay trong luồng — ảnh thu nhỏ của trang, tiêu đề, host, dòng "Mở trong trình duyệt AWOG", nút **Mở** và menu `⋮` — kiểu Claude Desktop. Người dùng thấy trang agent đang làm việc mà không phải mở panel nào. Liên quan: [session-browser-panel.md](session-browser-panel.md), [browser-tool.md](browser-tool.md).

## Luồng dữ liệu

```
agent gọi browser_tool(navigate|tab_new, url)
  ├─ Claude SDK: PreToolUse hook (run-stream.ts) ghi "phiếu" {tool_use id ↔ action+url+tabId} theo scope=session id
  │              handler MCP (browser-sdk-server.ts) nhận phiếu khớp → toolUseId
  └─ Pi:         execute(toolCallId, …) có sẵn id
        │
runBrowserAction (tools/browser-tool.ts)
  ├─ hostRequest('browser.navigate'|'browser.tabNew')      → url/title/tabId cuối (đã có sẵn trong kết quả tool)
  ├─ hostRequest('browser.thumbnail')                     → Electron main chụp, resize ≤640px, JPEG q70 (best-effort)
  └─ saveBrowserPreview(sessionId, toolUseId, …)           → ~/.awog/sessions/<sessionId>/thumbs/<key>.{jpg,json}
        │
UI: step có `browserPage:{url}` (suy từ INPUT trong step-mapper) → SessionMessageItem tách khỏi nhóm "N steps"
    → SessionBrowserCard → RPC `sessions.browserPreview {sessionId, stepId}` → data URL + title + tabId
```

- **Ảnh KHÔNG BAO GIỜ vào kết quả tool gửi cho model.** Kết quả `navigate`/`tab_new` giữ nguyên chữ như trước (đã có `url` + `title`); chi phí token không đổi.
- **Chụp là best-effort tuyệt đối.** Host trả `null` khi lỗi, timeout 5s ở sidecar, mọi lỗi lưu bị nuốt (`log.warn`). Thẻ vẫn hiện, không ảnh.
- **Chỉ phiên chat.** Node của Task có scope `task:…` — không có transcript để gắn thẻ nên bỏ qua.

## Khoá tương quan = tool_use id

Step id chính là `tool_use.id` ở cả đường live lẫn pointer-mode ([ADR 0097](../decisions/0097-claude-transcript-as-session-source.md): transcript dựng lại từ JSONL của Claude CLI qua `parseClaudeTranscript` → `stepFromToolUse`). Nên thẻ tìm lại được ảnh sau reload mà **không ghi thêm gì vào transcript**.

Handler MCP in-process của SDK không nhận tool_use id (không có `_meta` đo được ở `@anthropic-ai/claude-agent-sdk` 0.3.296), còn `PreToolUse` hook thì có và chạy trước handler. Hook ghi "phiếu" sau khi cổng quyền cho qua; handler nhận phiếu khớp theo dấu vân tay `[action, url, tabId]` **trong cùng scope** (hai phiên cùng điều hướng một URL không nhận nhầm). Phiếu dùng một lần, hết hạn sau 5 phút, tối đa 32/scope. Hai lời gọi trùng hệt nhận theo thứ tự. Không có phiếu ⇒ không lưu gì ⇒ thẻ không ảnh.

`thumbKey(stepId)`: id khớp `[A-Za-z0-9_-]{1,64}` giữ nguyên, còn lại (id lạ của provider khác) băm sha1 → `h-<24 hex>`. Ghi và đọc dùng chung một hàm.

## Lưu trữ + RPC

- `sessions/browser-previews.ts`: `saveBrowserPreview` / `readBrowserPreview`. Meta `{url,title,tabId,hasThumb}` đi qua zod khi đọc.
- Trần 512KB cho ảnh (ghi lẫn đọc). `lstat` từ chối symlink. `sessionId` qua `sanitizeChild` + charset + cấm tên toàn dấu chấm. Xoá session (`rm sessionDir`) dọn luôn `thumbs/`.
- RPC `sessions.browserPreview` → `{preview: {url,title,tabId,hasThumb,thumbDataUrl} | null}`. `null` = chưa lưu gì (session cũ, chụp lỗi).

## UI

- `StepBlock.page` ← `EngineStep.browserPage` ← `pickBrowserPage` (step-mapper: `browser_tool` + `navigate`/`tab_new` + `http(s)` url). Có từ lúc step còn `running` (thẻ hiện khung + spinner), nên không có cú "nhảy" khi kết quả về.
- `SessionMessageItem.grouped`: step có `page` và `status !== 'error'` → `flush()` nhóm activities rồi đẩy group `browser` đứng riêng (cũng render ở `SessionTurnFullscreen`). Step lỗi quay về hàng step thường.
- `SessionBrowserCard.vue`: ảnh (khung 16:10, căn top) · tiêu đề (rơi về host) · `host · Mở trong trình duyệt AWOG` · **Mở** · `⋮`.
  - **Mở**: tab còn sống (`api.tabs(scope)` có `tabId`) ⇒ `useSessionMainTabs().setMainTab` (+ `openWebTab` trong workbench); tab đã đóng ⇒ `openInApp(url)` (tab MỚI qua đường mở-link của người dùng, vẫn đi qua guard host ở main).
  - **⋮**: *Mở bằng trình duyệt của tôi* (`openExternally`) · *Sao chép URL*.
- `composables/useBrowserPreview.ts`: cache cấp module (cap 40 thẻ), chỉ hỏi sidecar khi step `done`.
- i18n: `sessions.browserCard.*` (en + vi).

## Bảo mật

- Ảnh là L1 (nội dung trang): chỉ gán vào `<img :src>`, không `v-html`. Không bao giờ qua kênh model.
- Host cho `browser.thumbnail` kiểm scope ↔ ownership như mọi `browser.*` (`this.tab(tabId, scope)`).
- Ảnh có thể chứa nội dung nhạy cảm của trang đã đăng nhập; nó nằm trong `~/.awog/sessions/<id>/thumbs/` cùng chỗ với transcript và bị xoá cùng session.

## Giới hạn đã biết

- Nhánh Codex (`provider === 'openai'`) chưa nối: adapter của nó không đi qua `execute(toolCallId)` của `createBrowserTool` ⇒ [INFERENCE] thẻ hiện nhưng không ảnh.
- Ảnh chụp theo viewport của tab lúc đó; trang tải chậm/SPA có thể chụp lúc chưa vẽ xong.
- Phiếu hook→handler khớp theo dấu vân tay; hai lời gọi song song trùng hệt nhau có thể đảo cặp id (hậu quả: hai thẻ hoán đổi ảnh — vô hại vì cùng URL).
