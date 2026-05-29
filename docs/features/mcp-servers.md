# Feature: MCP Servers

**Trạng thái:** Implemented (Pha 1 stdio + Pha 2A http/secret keychain/per-agent whitelist/idle stop/fs watcher)

> **Note (2026-05-29):** Feature này hấp thụ luôn vai trò của Context Providers cũ (đã deprecated — xem [ADR 0016](../decisions/0016-deprecate-context-providers-fold-into-mcp.md)). Mọi data source ngoài (Notion, Jira, Slack, GitHub, filesystem, gitnexus…) đều đi qua MCP.
>
> **Pha 2A đã implement:**
> - **Per-agent whitelist** qua `agent.mcpServerIds` (B1 — [ADR 0015](../decisions/0015-agents-persisted-runtime-systemprompt.md) update). Session intersect 2-layer (session + agent).
> - **Transport `http`** qua `mcp/http-client.ts` với SSRF guard (B3 — [ADR 0014](../decisions/0014-mcp-servers-stdio-runtime.md) update). Streamable HTTP support.
> - **Secret keychain** — env/header value `secret:KEY` được expand từ OS keychain qua `@napi-rs/keyring`, plaintext không chạm JSON config (B2 — [ADR 0018](../decisions/0018-mcp-secret-keychain.md)). UI: 🔒 toggle per row trong McpEditor.
> - **Idle stop** — autoStart=false servers tự stop sau 5 phút idle, free RAM (C2).
> - **Filesystem watcher** — chokidar emit `mcp-servers.fs-changed` khi `*.json` thay đổi ngoài app → UI auto re-hydrate (C1).
>
> **Còn defer pha 2B**: `sse` transport (spec MCP chuyển sang Streamable HTTP đã handle), B4 sandbox stdio, B5 hot reload schema, B7 persistent McpManager process bridging, B8 remote registry discovery.

## Overview

MCP (Model Context Protocol) server là tiến trình bên ngoài AWOG cung cấp **tool**, **resource** và **prompt** cho agent qua giao thức chuẩn của Anthropic. Trong khi [context-provider](./context-providers.md) là loại nguồn tri thức **built-in** do AWOG implement, MCP server là **plugin do bên thứ ba viết** — người dùng cài thêm để mở rộng năng lực agent mà không sửa code AWOG.

Ví dụ: gắn MCP server `gitnexus` để agent gọi `query_codebase`, hoặc gắn `playwright` để agent điều khiển trình duyệt khi viết test E2E.

## Scope pha 1 (MVP) vs Pha 2

| Khía cạnh | Pha 1 (MVP) | Pha 2 |
|---|---|---|
| Transport | **`stdio` only** | `stdio` + **`http` ✓ (pha 2A B3)**; `sse` defer (spec đang chuyển sang Streamable HTTP — `http` đã handle SSE response payload) |
| Built-in preset | **GitHub + Filesystem** (2 preset cứng) | Discovery qua remote registry |
| Secret injection | `${env:VAR}` từ env user; `${secret:...}` placeholder **không expand** (báo warning) | Tích hợp OS keychain qua [settings](./settings.md) |
| Per-agent trust override | Global trust per-server | Per-agent + per-tool trust |
| Sandbox stdio | Không sandbox (chạy với quyền user) | macOS sandbox-exec / Linux namespace |
| Hot reload | Restart manual sau khi sửa config | Tự reload khi tool list thay đổi |
| Auto-restart | Max 3 lần / 60s | Configurable backoff per-server |

> **Lý do chọn stdio cho pha 1:** ~80% MCP server hiện hữu (`@modelcontextprotocol/server-*`) là stdio. Không phải xử lý SSRF, allowlist host, credential storage — giảm surface tấn công đáng kể. Cấu trúc `MCPServer` type đã có sẵn field cho cả 3 transport, không phá vỡ khi mở rộng pha 2.

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

### "+ Add MCP Server" — Skills-style conversational creator (pha 1)

Tham chiếu pattern UI của Skills ([`pages/skills/index.vue`](../../apps/desktop/ui/pages/skills/index.vue) + [`components/skill/SkillPromptCreator.vue`](../../apps/desktop/ui/components/skill/SkillPromptCreator.vue)). Khi user click "+ New":

1. Modal mở ra ở vị trí anchor của nút "+ New" (cùng `cardPos` logic với Skills).
2. **Chat-style log** — user mô tả MCP server muốn cài; LLM (agent ở sidecar) drive flow:
   - Hỏi service (nếu chưa rõ).
   - Pick preset cứng (GitHub/Filesystem) nếu match, hoặc tự suy ra `command/args/env` từ mô tả.
   - Gọi tool `mcp.test` để verify spawn được.
   - Gọi tool `mcp.upsert` để ghi `~/.awog/mcp-servers/<id>.json`.
3. **Streaming steps** hiển thị realtime với icon running/done/error:
   - `Discovering server template…`
   - `Testing connection…` (target: `npx -y @modelcontextprotocol/server-filesystem /tmp`)
   - `Writing config…` (target: `~/.awog/mcp-servers/fs-readonly.json`)
4. Khi user đóng modal → page gọi `mcp.list` (`hydrateMcpFromSidecar`) để lấy disk-truth, server vừa tạo xuất hiện trong list.

Lý do chọn pattern này thay vì wizard 3-step:
- Đồng nhất UX với Skills (đã wired và validated trong M7).
- LLM xử lý phần "research server template" — user không cần biết package name `@modelcontextprotocol/server-*`.
- Reuse `SessionStep` UI components.

> Wizard 3-step gốc bị thay thế. Manual edit vẫn dùng `McpEditor` form khi click "Edit details" trong modal hoặc Edit từ detail view.

### Edit existing

Click Edit trong detail → `McpEditor` form (giống skill edit), không qua LLM creator.

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

## RPC methods (sidecar)

Tương tự pattern `sessions.*` / `accounts.*`. UI gọi qua [`useSidecar()`](../../apps/desktop/ui/composables/useSidecar.ts).

| Method | Params | Trả về | Ghi chú |
|---|---|---|---|
| `mcp.list` | — | `MCPServer[]` | Snapshot từ disk (đọc `~/.awog/mcp-servers/*.json`) + state runtime trộn vào (status, tools, lastError, lastStartedAt). |
| `mcp.upsert` | `{ server: MCPServer }` | `MCPServer` | Validate qua zod. Ghi atomic `<id>.json`. Nếu `enabled && autoStart` → spawn ngay. |
| `mcp.delete` | `{ id }` | `{ ok: true }` | Stop process nếu đang chạy. Unlink file. |
| `mcp.toggle` | `{ id, enabled }` | `MCPServer` | Stop khi disable; start khi enable + autoStart. |
| `mcp.restart` | `{ id }` | `MCPServer` | Kill + spawn lại; reset backoff counter. |
| `mcp.test` | `{ server: MCPServer }` | `{ ok: boolean; tools?, resources?, error? }` | Spawn ephemeral, gọi `initialize` + `tools/list` + `resources/list`, kill. Dùng trong wizard step "Verify" trước khi save. |
| `mcp.discoverPreset` | `{ presetId: 'github' \| 'filesystem' }` | `Partial<MCPServer>` | Trả về config template (command, args, env keys cần) cho preset cứng. Không spawn. |
| `mcp.author` | `{ messageId, prompt, history? }` | `{ messageId, finalText }` | Streaming. LLM agent ở sidecar drive flow: research → test → upsert. Phát event `mcp.author.chunk/step/done`. Reuse pattern `skills.author`. |

### Streaming events (notification, no `id`)

Phát qua channel `sidecar.event` khi runtime trạng thái thay đổi hoặc LLM creator streaming:

```jsonc
{ "type": "mcp.status",
  "payload": { "id", "status": "starting|running|error|disabled|idle",
               "lastError?": "...", "tools?": MCPTool[], "resources?": MCPResource[] } }
{ "type": "mcp.stderr-line",
  "payload": { "id", "line": "...", "at": "ISO timestamp" } }
{ "type": "mcp.author.chunk",
  "payload": { "messageId", "delta": "..." } }
{ "type": "mcp.author.step",
  "payload": { "messageId", "step": { id, label, target?, status: 'running'|'done'|'error' } } }
{ "type": "mcp.author.done",
  "payload": { "messageId", "text": "...", "createdServerId?": "..." } }
```

UI append `stderr-line` vào ring buffer 100 dòng cho tab Logs. `mcp.status` cập nhật badge ngay không cần refetch.

## Acceptance Criteria

### AC-1: Tạo MCP server stdio mới (manual)
- **Given** user mở Settings → MCP Servers, click "+ Add Server" → chọn "Custom"
- **When** điền `command=npx`, `args=["-y","@modelcontextprotocol/server-filesystem","/tmp"]`, `transport=stdio`, click "Verify"
- **Then** sidecar spawn ephemeral process, gọi MCP `initialize`, hiển thị danh sách tool/resource detect được trong vòng ≤ 5s
- **And** click "Save" → file `~/.awog/mcp-servers/<id>.json` xuất hiện; nếu `enabled && autoStart` → status badge chuyển `starting → running`

### AC-2: Tạo từ preset cứng
- **Given** user click "+ Add Server" → "From registry"
- **When** chọn "Filesystem" hoặc "GitHub"
- **Then** form auto-fill `command/args/env keys`; user chỉ cần điền path (Filesystem) hoặc `GITHUB_PERSONAL_ACCESS_TOKEN` env (GitHub)
- **And** quy trình save giống AC-1

### AC-3: Restart-safe sau crash sidecar
- **Given** đang có 2 MCP server `enabled=true, autoStart=true` chạy
- **When** sidecar crash hoặc restart
- **Then** sau khi sidecar lên lại, `mcp.list` trả về 2 server với status `idle` (chưa spawn), trong vòng ≤ 2s từ khi sidecar ready → status chuyển `running` cho từng server

### AC-4: Tool list được session sử dụng
- **Given** có 1 MCP server `gitnexus` status `running` với 5 tool
- **When** user gửi message trong session, model trả `tool_use` block với `name=mcp__gitnexus__query`
- **Then** sidecar dispatch tool call tới server gitnexus, await result, đưa lại model
- **And** trace log của session ghi `tool` node với `mcpServerId=gitnexus`

### AC-5: Crash backoff
- **Given** 1 MCP server crash liên tục
- **When** sidecar tự restart 3 lần trong 60s đều fail
- **Then** status chuyển `error` cứng, không retry thêm; hiển thị nút "Restart" để user trigger thủ công

### AC-6: Disable server runtime
- **Given** server đang `running`
- **When** user toggle `enabled=false`
- **Then** sidecar gửi SIGTERM, đợi ≤ 2s, SIGKILL nếu không chết, status → `disabled`
- **And** session đang dùng tool từ server đó nhận error `mcp-server-disabled` ở lần call tiếp theo

### AC-7: Path argument an toàn (Filesystem MCP)
- **Given** user dùng preset Filesystem với args trỏ tới path
- **When** path chứa `..` literal hoặc symlink ra ngoài `~`
- **Then** sidecar reject ở `mcp.upsert`, error `path-out-of-scope`, không ghi file
- **Lưu ý:** AWOG chỉ sanitize path do user nhập trực tiếp vào args. Tool args đến từ LLM ở runtime do server filesystem tự kiểm tra (boundary của họ).

### AC-8: Stderr log accessible
- **Given** server đang chạy, ghi stderr `[error] failed to connect ...`
- **When** UI mở tab Logs trong server detail
- **Then** hiển thị tối đa 100 dòng gần nhất, đảo ngược (mới ở trên), realtime append khi có event `mcp.stderr-line`

### AC-9: Offline-safe
- **Given** preset cứng, không có internet
- **When** user click "Filesystem" preset
- **Then** form auto-fill thành công (preset là static config trong code, không gọi remote registry)

## Edge cases

- **Command không tồn tại** (`command=foo` không có trong PATH): `mcp.test` báo `ENOENT`, không tạo file config trừ khi user explicit save anyway.
- **MCP server đổi tool list giữa các phiên** (server bump version, thêm tool): mỗi lần `running` mới đều call lại `tools/list` và cập nhật cache; UI hiển thị diff "+/- tools" trong tab Tools.
- **Trùng id**: `mcp.upsert` reject nếu file đã tồn tại và mode = create. UI có nút "Duplicate" tạo id mới `<id>-copy`.
- **stdout của server không phải JSON-RPC hợp lệ**: log dòng đó vào stderr buffer, không crash sidecar.
- **Args/env chứa `${env:VAR}` mà VAR không tồn tại**: spawn fail với error rõ ràng `env-missing: VAR`.

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
