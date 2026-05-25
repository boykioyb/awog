# Feature: MCP Servers

**Trạng thái:** Draft

## Overview

MCP (Model Context Protocol) server là tiến trình bên ngoài AWOG cung cấp **tool**, **resource** và **prompt** cho agent qua giao thức chuẩn của Anthropic. Trong khi [context-provider](./context-providers.md) là loại nguồn tri thức **built-in** do AWOG implement, MCP server là **plugin do bên thứ ba viết** — người dùng cài thêm để mở rộng năng lực agent mà không sửa code AWOG.

Ví dụ: gắn MCP server `gitnexus` để agent gọi `query_codebase`, hoặc gắn `playwright` để agent điều khiển trình duyệt khi viết test E2E.

## User Stories

- Là người dùng, tôi muốn cài MCP server `filesystem` để agent đọc/ghi file ngoài workspace.
- Là người dùng, tôi muốn gán MCP server `linear` riêng cho agent Project Manager để nó tự tạo issue.
- Là người dùng, tôi muốn xem danh sách tool mỗi MCP server expose để biết agent có thể làm gì.
- Là người dùng, tôi muốn bật/tắt một MCP server tạm thời mà không xóa cấu hình.
- Là người dùng, tôi muốn thấy log khi MCP server gặp lỗi (process crash, schema invalid).

## Loại MCP server hỗ trợ

| Transport | Cách chạy | Use case |
|---|---|---|
| `stdio` | Sidecar spawn process, giao tiếp qua stdin/stdout | Mặc định, local tool (filesystem, sqlite, git) |
| `http` | Kết nối tới URL có sẵn (server từ xa) | Service cloud (Notion MCP, Linear MCP) |
| `sse` | Server-Sent Events qua HTTP | Server stateful, streaming response |

> stdio và http là 2 cách triển khai chính. SSE đưa vào sau khi spec MCP ổn định.

## MCP server list view

- Search box, **transport filter** (stdio / http / sse), trạng thái filter (enabled / disabled / error).
- Item: name (mono font) + transport badge + tool count + trạng thái dot (xanh = healthy, vàng = starting, đỏ = error, xám = disabled).
- "+ Add MCP Server" mở wizard.

## MCP server detail view

- Name (mono) + transport badge + version (nếu server expose).
- **Trạng thái real-time** — connection status, uptime, last error.
- 3 action: **Restart**, **Edit**, **Remove**.
- 3 tab:
  - **Tools** — bảng tool name + input schema + description.
  - **Resources** — bảng resource URI template + mime type.
  - **Prompts** — bảng prompt name + argument schema (nếu server expose).
- **Used by** — list agent đã whitelist server này.
- **Logs** (collapsible) — 100 dòng gần nhất stderr của server.

## MCP server editor

### Wizard "+ Add MCP Server"

3 bước:

1. **Source** — chọn:
   - **From registry** — danh sách MCP server phổ biến đã được verified (filesystem, gitnexus, sqlite, github, …). Click để auto-fill config.
   - **Custom** — user nhập tay.
2. **Configuration** — form theo transport:
   - **stdio**: `command` (executable path), `args` (string[]), `env` (key-value), `cwd` (optional).
   - **http**: `url`, `headers` (key-value, hỗ trợ `${env:VAR}` để inject secret từ keychain).
   - **sse**: như http.
3. **Verify** — sidecar spawn thử, gọi `initialize`, hiển thị tool/resource detect được. Nếu fail → show stderr, cho phép back.

### Edit existing

Form giống wizard nhưng bỏ qua step 1.

## Thuộc tính MCP Server

| Field | Kiểu | Mô tả |
|---|---|---|
| `id` | string | Slug duy nhất, ví dụ `gitnexus`, `playwright-local` |
| `name` | string | Tên hiển thị |
| `description` | string | Mô tả ngắn |
| `transport` | enum | `stdio` / `http` / `sse` |
| `command` | string? | Chỉ cho stdio: executable (ví dụ `npx`, `uvx`, absolute path) |
| `args` | string[]? | Chỉ cho stdio |
| `env` | Record<string,string>? | Env vars, value hỗ trợ `${secret:keyname}` để lấy từ keychain |
| `cwd` | string? | Working dir cho stdio |
| `url` | string? | Chỉ cho http/sse |
| `headers` | Record<string,string>? | Chỉ cho http/sse, hỗ trợ `${secret:...}` |
| `enabled` | boolean | Bật/tắt nhanh, không xóa config |
| `autoStart` | boolean | True = start khi AWOG khởi động; false = on-demand (lazy) |
| `timeoutMs` | number | Default 30000, timeout cho mỗi tool call |
| `trust` | enum | `prompt` / `allow` / `deny` — chế độ approval cho tool call (xem [human-approval](./human-approval.md)) |

### Ví dụ cấu hình stdio (filesystem MCP)

```json
{
  "id": "fs-readonly",
  "name": "Filesystem (read-only)",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/alice/notes"],
  "env": {},
  "enabled": true,
  "autoStart": true,
  "timeoutMs": 30000,
  "trust": "allow"
}
```

### Ví dụ cấu hình http (Notion MCP)

```json
{
  "id": "notion-cloud",
  "name": "Notion",
  "transport": "http",
  "url": "https://mcp.notion.com/v1",
  "headers": {
    "Authorization": "Bearer ${secret:notion_token}"
  },
  "enabled": true,
  "autoStart": false,
  "timeoutMs": 60000,
  "trust": "prompt"
}
```

## Vòng đời (lifecycle)

```
disabled ──enable──> idle ──autoStart──> starting ──ok──> running
                                            │              │
                                            └─error──> error (logs giữ lại)
                                                           │
                                            └────restart──┘
```

- **autoStart=true**: start ngay sau khi load settings; restart tự động khi crash (max 3 lần / 60 giây, sau đó vào trạng thái `error`).
- **autoStart=false**: start lần đầu khi có agent gọi tool; idle timeout 5 phút không call → stop để giảm RAM.
- **Restart manual** xóa backoff counter.
- Process group: stdio server chạy trong sidecar process group; khi sidecar tắt → tất cả MCP server cũng dừng (không leak).

## Tích hợp với Agent

Agent khai báo `mcpServers: string[]` (whitelist server id). Khi agent chạy:

1. Sidecar gom tool/resource/prompt từ các server trong whitelist.
2. Tool list được attach vào system prompt (theo format Anthropic tool use).
3. Khi LLM gọi tool, sidecar dispatch về MCP server tương ứng, await response, đưa lại LLM.
4. Mỗi tool call ghi vào [agent-trace](./agent-trace.md) dưới node `tool` với metadata `mcpServerId`.

### Approval flow

`trust` field quyết định behavior khi LLM yêu cầu gọi tool:

| trust | Behavior |
|---|---|
| `allow` | Gọi luôn, log vào trace |
| `prompt` | Tạm dừng phase → human approve trong tab Discussion → tiếp tục |
| `deny` | Reject ngay, LLM nhận error, có thể thử tool khác |

Per-agent override: agent có thể set trust riêng cho từng server (overrides setting global của server).

## Lưu trữ dữ liệu

`workspace/mcp-servers/<server-id>.json` — một file một server.

`workspace/sessions/<agent>/mcp-state.json` — runtime state (last started, error count) per-agent. Không commit Git.

Secret (token, API key) **không lưu trong JSON** — chỉ lưu reference `${secret:keyname}`. Value thật ở [Settings → Models & API Keys](./settings.md) → OS keychain.

## UI/UX Notes

- MCP server list nằm trong **Settings → MCP Servers** (section thứ 5, bổ sung vào 4 section hiện có).
- Trong Agent editor, **Context Providers** và **MCP Servers** là 2 picker tách biệt nhưng layout giống nhau — pill toggleable.
- Empty state list: gợi ý 3 server phổ biến (filesystem, gitnexus, github) với 1-click install.
- Khi server `error`, badge đỏ + tooltip lý do. Không tự retry vô hạn — yêu cầu user click Restart.

## Bảo mật

8 invariant AWOG ([rules/security.md](../../.claude/rules/security.md)) áp dụng:

- **stdio server chạy in-sidecar process group**, không expose port.
- **http server allowlist host** — config save vào file, nhưng sidecar check `URL.host` ∈ allowlist trước fetch. Allowlist mặc định gồm host phổ biến (mcp.notion.com, …) + user thêm tay qua settings → một whitelist URL pattern.
- **env/headers expand `${secret:...}`** chỉ ở sidecar, không bao giờ ở UI / log.
- **Path argument** cho stdio (ví dụ filesystem MCP) phải sanitize: resolve absolute, reject path traversal nếu trỏ ngoài workspace (trừ khi user explicit allow trong setting).
- **Tool call vào MCP** đi qua trace → log có thể bị xem; sidecar **sanitize secret** trước khi ghi (regex mask `Bearer xxx`, `sk-xxx`).
- **Schema validation** — input/output mỗi tool validate qua zod theo schema MCP server expose. Reject call không match.

## Phụ thuộc

- [agent-builder](./agent-builder.md) — agent whitelist MCP server.
- [context-providers](./context-providers.md) — phân biệt built-in vs plugin.
- [agent-trace](./agent-trace.md) — log tool call.
- [human-approval](./human-approval.md) — approval gate khi `trust: prompt`.
- [settings](./settings.md) — secret keychain, allowlist host.
- [hooks](./hooks.md) — event `mcp-server-error` có thể trigger hook.

## Out of Scope

- **Tự host MCP marketplace** trong app — chỉ link tới registry chính thức.
- **Tự viết MCP server trong AWOG** — user dùng SDK của Anthropic.
- **OAuth flow tự động** cho HTTP server — user lo lấy token bên ngoài, paste vào.
- **Hot reload schema** — đổi config phải Restart.

## Câu hỏi mở

- Khi MCP server đổi tool list giữa các phiên, agent cache cũ xử lý ra sao? Force re-init?
- Có nên cho phép một agent có **per-tool trust** (allow tool A, prompt tool B của cùng server)?
- Sandbox cho stdio server (Linux namespace / macOS sandbox-exec) — bắt buộc hay opt-in?
- Quản lý version: pin MCP server version qua `npx -y pkg@x.y.z` hay để latest? Default nên là gì?
- Registry chính thức: dùng list của Anthropic, tự maintain, hay cả hai?
