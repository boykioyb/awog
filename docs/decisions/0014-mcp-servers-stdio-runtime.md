# 0014 — MCP Servers runtime: stdio-only pha 1, per-file JSON, in-sidecar process group

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-28
- **Người quyết định:** Tech Lead

## Bối cảnh

[Feature MCP servers](../features/mcp-servers.md) đã có spec đầy đủ và UI scaffold (page, components, types `MCPServer`). UI hiện chạy bằng mock data trong [`stores/workspace.ts`](../../apps/desktop/ui/stores/workspace.ts) — không persist, không spawn process thật, không nối với session.

Cần chốt 4 quyết định kỹ thuật trước khi developer triển khai:

1. **Transport scope pha 1.**
2. **Persistence schema** (theo pattern nào).
3. **Process lifecycle & ownership** (ai spawn, ai dọn, restart backoff).
4. **Integration với Claude Agent SDK** trong [`methods/sessions.send-message.ts`](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts).

Ràng buộc đến từ:
- [`.claude/rules/security.md`](../../.claude/rules/security.md) — 8 invariant (path sanitize, IPC boundary, no eval, no SSRF…).
- [ADR 0001](./0001-local-first-storage.md) — filesystem là data layer, không database.
- [ADR 0008](./0008-stdio-ipc-for-sidecar.md) — UI ↔ sidecar qua stdio JSON-RPC.
- [ADR 0012](./0012-projects-storage.md) — pattern plain JSON per-file đã được chọn cho metadata ít mutate.
- Anthropic SDK [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) đã có sẵn option `mcpServers` để pass khi `query`.

## Quyết định

### Q1. Transport pha 1: chỉ `stdio`

Pha 1 implement duy nhất `transport: 'stdio'`. Type `MCPServer` vẫn giữ field cho `http`/`sse` để pha 2 mở rộng không break schema; nhưng `mcp.upsert` reject với `transport-not-supported` nếu `transport !== 'stdio'`.

### Q2. Persistence: plain JSON per-file

Theo đúng pattern [ADR 0012](./0012-projects-storage.md):

- **Path:** `~/.awog/mcp-servers/<id>.json` (mode 0700 dir, 0600 file).
- **Filename:** `sanitizeChild(id)` chống traversal, id format `mcp-<timestamp>-<rand>` hoặc id user nhập (validate `^[a-z0-9][a-z0-9-]{0,62}$`).
- **Atomic write:** tmp + rename, reuse helper từ `projects/store.ts`.
- **Validate:** zod schema ở RPC boundary, parse từng file riêng khi `mcp.list` (file hỏng → skip + log, không crash).
- **Runtime state** (status, lastError, tools snapshot, lastStartedAt) **không** persist xuống disk — giữ trong RAM của sidecar, build lại sau restart bằng cách `idle → autoStart spawn`.

Lý do:
- Số lượng MCP server: ít (vài → vài chục).
- Mutate hiếm: tạo, sửa env, toggle enable.
- Không cần audit lịch sử (khác `sessions.jsonl`).
- Đồng nhất với projects → developer tái sử dụng helper.

### Q3. Lifecycle: McpManager singleton, in-sidecar process group

Một `McpManager` singleton trong sidecar quản trạng thái runtime:

```
McpManager
  ├── start(serverId): spawn process, init MCP handshake, list tools/resources
  ├── stop(serverId): SIGTERM → 2s timeout → SIGKILL
  ├── restart(serverId): stop → start, reset backoff
  ├── callTool(serverId, name, args): JSON-RPC request qua stdin của child
  ├── getSnapshot(): MCPServer[] (config + runtime state)
  └── shutdown(): stop all (called khi sidecar SIGTERM)
```

Quy tắc lifecycle:
- **Spawn**: `execFile('node'|'npx'|<command>, [...args], { env, cwd, stdio: ['pipe','pipe','pipe'] })`. Không qua shell, args array để chặn cmd injection.
- **Env**: kế thừa `process.env` của sidecar **lọc whitelist** (`PATH`, `HOME`, `USER`, `LANG`, `TZ`) + merge `config.env` user khai báo. Không leak `ANTHROPIC_API_KEY`, OAuth token, etc.
- **cwd**: nếu user khai báo, phải `path.resolve` + `startsWith(os.homedir())`, reject nếu ngoài; default = `os.homedir()`.
- **Process group**: trên POSIX, spawn với `detached: false` để inherit process group; khi sidecar exit, child nhận SIGTERM. Trên Windows dùng `windowsHide: true` + job object (Node 20+ tự handle).
- **Auto-restart**: nếu crash, backoff 1s/3s/5s, reset counter sau 60s success; quá 3 lần trong 60s → status `error` cứng.
- **Idle stop** (autoStart=false): sau 5 phút không có tool call → `stop()`. Pha 1 **không implement** idle stop để giảm complexity; mọi server `enabled=true` đều giữ chạy khi `autoStart=true`, hoặc spawn lazy lần đầu có tool call và giữ chạy đến khi disable.

### Q4. Integration với Claude Agent SDK

Tại [`methods/sessions.send-message.ts`](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts), khi build option cho `query()`:

```ts
import { mcpManager } from '../mcp/manager'

const runningServers = mcpManager.getSnapshot()
  .filter((s) => s.enabled && s.status === 'running' && s.transport === 'stdio')

const mcpServersForSdk = Object.fromEntries(
  runningServers.map((s) => [s.id, {
    type: 'stdio' as const,
    command: s.command!,
    args: s.args ?? [],
    env: filteredEnv(s),
  }])
)

query({ ..., mcpServers: mcpServersForSdk })
```

Lưu ý: SDK tự handle spawn process. Câu hỏi quan trọng là **ai spawn**: `McpManager` của AWOG (để UI thấy status + log + restart) **hay** Claude Agent SDK (mỗi session tự spawn process riêng)?

**Chọn: SDK spawn cho per-session lifecycle.** McpManager giữ vai trò:
- Persist config + validate.
- "Verify" UX (spawn ephemeral trong `mcp.test`, kill ngay).
- Health probe định kỳ (mỗi 30s spawn ephemeral check) — pha 2.

Lý do: SDK quản lý chu kỳ tool call trong session đã đủ tốt; nếu McpManager cũng giữ process song song sẽ có 2 instance của cùng server → confuse và lãng phí.

Trade-off: UI status `running` thực ra phản ánh **kết quả của `mcp.test` gần nhất**, không phải process live của session. Acceptable cho pha 1 — pha 2 xem xét đẩy spawn lên McpManager và share qua SDK's `transport` option khi SDK cho phép.

## Phương án đã cân nhắc

### McpManager spawn + maintain persistent process; SDK gọi qua transport bridge

McpManager spawn 1 process per server, giữ alive xuyên session. SDK call tool qua một transport adapter chuyển tiếp.

- **Từ chối:** SDK hiện chưa expose `transport` mở rộng, phải hack bridge stdio. Tăng complexity gấp 3, debug khó. Trade-off "UI status chính xác hơn" không xứng.

### Tích hợp craft-agents pattern "sources" (folder per server với config + permissions + guide)

Mỗi server 1 folder chứa `config.json`, `permissions.json`, `guide.md`.

- **Từ chối pha 1:** AWOG chưa có permission engine per-tool. `guide.md` (AGENTS.md-style) hữu ích nhưng overlap với context-providers. Để pha 2 khi cần per-tool gating.

### JSONL event-sourced như `sessions`

- **Từ chối:** Mutate quá hiếm, không cần audit. Đã từ chối lý do tương tự ở ADR 0012.

### Tauri sidecar API thay vì in-sidecar process group

- **Từ chối:** Tauri shell chưa wire ([ADR 0006](./0006-tauri-shell-for-nuxt.md) status planned). MCP feature không thể chờ. Node `child_process.execFile` đủ dùng.

## Hệ quả

- **Tích cực:**
  - Surface tấn công nhỏ (chỉ stdio, không SSRF, không credential storage).
  - Reuse pattern store đã có (projects).
  - SDK quản lý spawn → ít code McpManager.
  - UI scaffold sẵn → developer chỉ wire store + thêm sidecar methods.
- **Tiêu cực / Trade-off:**
  - UI status không 100% realtime vì process spawn bởi SDK trong từng session, không bởi McpManager (xem Q4 trade-off).
  - Pha 1 không có http/sse — user có MCP remote phải chờ.
  - Pha 1 không có per-tool trust, secret keychain (chỉ env).
  - Process group lifecycle dựa vào Node default — chưa test kỹ trên Windows (cần dx-ops verify trước release).
- **Việc cần làm tiếp:**
  - **TASK-1**: thêm sidecar module `apps/desktop/sidecar/src/mcp/`:
    - `store.ts` — CRUD file `~/.awog/mcp-servers/*.json` (reuse atomic write từ projects).
    - `manager.ts` — `McpManager` class (start/stop/test/getSnapshot).
    - `presets.ts` — config tĩnh cho `github` và `filesystem`.
    - `schema.ts` — zod schema cho `MCPServer`.
  - **TASK-2**: thêm 7 RPC method (`mcp.list`, `mcp.upsert`, `mcp.delete`, `mcp.toggle`, `mcp.restart`, `mcp.test`, `mcp.discoverPreset`) ở `apps/desktop/sidecar/src/methods/`.
  - **TASK-3**: cập nhật `stores/workspace.ts` mcpServers section — gọi sidecar thay vì giả lập (giữ in-memory cache để snappy, hydrate từ `mcp.list` khi mount).
  - **TASK-4**: subscribe `sidecar.event` cho `mcp.status` + `mcp.stderr-line` ở store.
  - **TASK-5**: wire `mcpServers` vào `sessions.send-message.ts` build option.
  - **TASK-6**: cập nhật `McpPromptCreator` để gọi `mcp.discoverPreset` cho "From registry" path.
  - **TASK-7**: doc update — `apps/desktop/ui/README.md` thêm route `mcp-servers` đã wire, `CLAUDE.md` thêm `~/.awog/mcp-servers/` vào folder map.
  - Câu hỏi mở của spec (sandbox, per-tool trust, registry discovery) → defer pha 2.

## Tham chiếu

- [docs/features/mcp-servers.md](../features/mcp-servers.md)
- [ADR 0001 — local-first storage](./0001-local-first-storage.md)
- [ADR 0008 — stdio IPC cho sidecar](./0008-stdio-ipc-for-sidecar.md)
- [ADR 0012 — projects storage](./0012-projects-storage.md)
- [.claude/rules/security.md](../../.claude/rules/security.md)
- Anthropic [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — option `mcpServers` trong `query()`.
- [craft-agents-oss `packages/shared/src/mcp/`](https://github.com/craft-ai-agents/craft-agents-oss/tree/main/packages/shared/src/mcp) — tham chiếu (không copy 1-1).
