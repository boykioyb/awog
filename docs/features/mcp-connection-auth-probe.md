# MCP Connection — Auth probe khi Test

## Vấn đề

Nút **Test connection** trước đây chỉ chạy handshake MCP (`initialize` + `tools/list`).
Với server stdio (vd GitHub), token chỉ được dùng kiểu *lazy* — khi gọi tool thật —
nên handshake luôn pass **kể cả khi không nhập / nhập sai token**. "Connection OK"
vì thế gây hiểu nhầm: nó xác nhận *kết nối* chứ không xác nhận *xác thực*.

MCP không có lệnh chuẩn nào để kiểm tra auth; ba lệnh phổ quát
(`initialize`/`tools/list`/`resources/list`) đều không bắt buộc token.

## Giải pháp

Thêm **auth probe tuỳ chọn theo từng connection**: sau handshake, Test gọi thật một
tool chỉ-đọc (`tools/call`) để xác minh token authenticate. Vì child process lúc
test đã được bơm token (qua `buildEnv` → `expandSecrets`), cú gọi này xác thực thật.

### Config

Thêm field tuỳ chọn vào MCP server config (persist ra `~/.awog/mcp-servers/<id>.json`):

```jsonc
"healthCheck": {
  "tool": "list_issues",              // tên tool sẽ gọi sau handshake
  "args": { "owner": "me", "repo": "x" } // args truyền vào tools/call (tuỳ chọn)
}
```

- Schema: `McpHealthCheckSchema` ([schema.ts](../../apps/desktop/sidecar/src/mcp/schema.ts)),
  type `McpHealthCheck` ([shared.ts](../../apps/desktop/sidecar/src/types/shared.ts)).
- Không có `healthCheck` → Test giữ hành vi cũ (chỉ handshake).

### Kết quả Test (3 mức)

| Trạng thái | Ý nghĩa |
|---|---|
| Handshake fail | Kết nối hỏng (spawn / protocol). `ok=false`. |
| Handshake OK, không cấu hình probe | "Connection OK · N tools" (auth chưa kiểm tra). |
| Handshake OK + probe OK | "Authenticated ✓ via `<tool>`". |
| Handshake OK + probe fail | "Connected, but auth failed" + lỗi từ tool (vd 401). |

Probe phân biệt cả hai kiểu lỗi: JSON-RPC error (reject) **và** `result.isError=true`
(MCP trả lỗi tool trong result, không phải error frame).

## Luồng dùng

1. Connections → chọn connection → **Edit**.
2. Mục **Auth check (optional)**: chọn tool từ danh sách đã detect (bấm **Verify**
   trước để liệt kê), điền args JSON nếu tool cần.
3. **Verify** / **Save** → Test sẽ chạy probe và hiện "Authenticated ✓" hoặc lỗi auth.

## Lưu ý chọn tool (quan trọng)

**Chọn tool đọc dữ liệu cần đăng nhập.** Tool public (vd `search_repositories` của
GitHub dùng search API công khai) có thể pass *kể cả token rỗng/sai* → false positive.

- GitHub (`@modelcontextprotocol/server-github`): dùng tool chạm dữ liệu private,
  vd `list_issues` / `get_file_contents` trên một repo private của bạn.
- Nếu dùng server GitHub bản Go (`github/github-mcp-server`): `get_me` là probe lý
  tưởng (không args, bắt buộc auth).

## Files

- Sidecar: [schema.ts](../../apps/desktop/sidecar/src/mcp/schema.ts),
  [types/shared.ts](../../apps/desktop/sidecar/src/types/shared.ts),
  [mcp/manager.ts](../../apps/desktop/sidecar/src/mcp/manager.ts) (`probeHealth`, `test*`).
- UI: [stores/connections.ts](../../apps/desktop/ui-next/stores/connections.ts),
  [ConnectionEditor.vue](../../apps/desktop/ui-next/components/connection/ConnectionEditor.vue),
  [ConnectionDetail.vue](../../apps/desktop/ui-next/components/connection/ConnectionDetail.vue).
- i18n: `connections.editor.health*` / `connections.detail.auth*` (en + vi).

## Bảo mật

- `args` là config của chính user (L2), gọi `tools/call` giống hệt lúc runtime —
  không mở thêm bề mặt tấn công. Token vẫn nằm trong keychain, không lộ qua UI/log.
- Probe chỉ chạy khi user chủ động bấm Test và tự cấu hình healthCheck.
