# Kiểm tra kết nối ngay sau khi cài MCP (installer verify)

## Bối cảnh

Trình cài connection (modal **New connection** → `mcp.author`) trước đây chỉ làm
một việc: cho model chạy tool `Write` ghi file `~/.awog/mcp-servers/<slug>.json`
rồi kết thúc bằng câu cứng `"Created … — toggle Enabled to start."`. Nó **không
thử kết nối**, nên "Created" = *file đã ghi*, không phải *server chạy được*. Người
dùng đóng modal mà không có tín hiệu nào về việc server có initialize được không;
lỗi thật (vd `MCP request timeout: initialize` khi bật Enabled) xuất hiện tách rời
ở màn detail, mất ngữ cảnh với lúc tạo.

Xem thêm bối cảnh timeout `npx` cold-start ở
[mcp-load-failure-hardening.md](./mcp-load-failure-hardening.md).

## Thay đổi

### A. Auto-verify sau khi Write — `methods/mcp.author.ts`

Sau khi `authorPi` kết thúc, nếu model **Write thành công** một file dưới
`mcp-servers/<slug>.json` (bắt slug từ `onToolResult`, chỉ khi `!isError` và slug
khớp `MCP_ID_RE`), sidecar tự chạy một handshake tạm thời:

1. Phát step `verify` trạng thái `running` (qua kênh `mcp.author.step` sẵn có).
2. `loadServer(slug)` → `mcpManager.test(config, { timeoutMs })`.
3. Phát step `verify` trạng thái `done` kèm dữ liệu có cấu trúc:
   `{ ok, toolCount, resourceCount, error?, stderr? }`.

Các step verify được phát **trước** event `mcp.author.done`, nên UI fold kết quả
verify (terminal) vào lượt chat đã hoàn tất. Helper `verifyWritten` **không bao
giờ throw** — config hỏng surface thành `ok:false`, không làm hỏng RPC author.

Timeout verify = `max(config.timeoutMs, 60s)`: lần đầu `npx -y <pkg>` còn phải
**tải package** trước khi nói được MCP, nên nới rộng ngân sách handshake.

### B. Đồng bộ timeout của `test()` với `start()` — `mcp/manager.ts`

Bỏ cap cứng `TEST_TIMEOUT_MS = 5000`. `test(config, opts?)` giờ dùng
`opts.timeoutMs ?? config.timeoutMs` (mặc định 30s, **bằng** `start()`), nên nút
"Test connection" thủ công ở detail không còn fail nhanh hơn lúc khởi động thật —
xoá nguồn hiểu lầm "test đỏ nhưng bật lại chạy".

### C. UI: step verify là banner — `components/library/CreatorStepRow.vue`

Tách một component row dùng chung cho cả hai vòng lặp step (persisted +
streaming) của [`LibraryCreatorPanel`](../../apps/desktop/ui-next/components/library/LibraryCreatorPanel.vue):

- Step thường: `zap` + label (như cũ).
- Step `kind: 'verify'`: banner
  - `running` → spinner + "Đang kiểm tra kết nối… (lần đầu có thể tải package)"
  - `done` + ok → check + "Đã kết nối · N tool, M resource" (viền accent)
  - `done` + fail → alert + "Kết nối thất bại" + `stderr`/error trong `<pre>`
    (viền danger)

I18n: `library.creator.verify.{running,ok,fail}` (en + vi).

## Bất biến / lưu ý

- Verify là **ephemeral** (spawn → handshake → kill), không bật Enabled và không
  chạm trạng thái runtime của manager. Câu "toggle Enabled to start" vẫn đúng.
- Chỉ `mcp.author` phát step verify; các panel author khác (skills/agents/…) dùng
  chung `LibraryCreatorPanel` không bao giờ nhận step này nên không đổi hành vi.
- Không đổi IPC contract ra UI (tái dùng kênh `mcp.author.step`).
