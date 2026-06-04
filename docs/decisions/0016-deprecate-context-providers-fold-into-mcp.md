# 0016 — Deprecate Context Providers, fold into MCP Servers

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-29
- **Người quyết định:** Tech Lead

## Bối cảnh

Spec gốc tách 2 feature song song:

- **[Context Providers](../features/context-providers.md)** (Draft, chưa implement) — 6 nguồn tri thức `built-in` cho agent: `artifacts`, `gitnexus`, `filesystem`, `notion`, `jira`, `slack`. Interface `list/read/search/write`. Per-agent whitelist qua `agent.context`.
- **[MCP Servers](../features/mcp-servers.md)** (Implemented pha 1 — [ADR 0014](./0014-mcp-servers-stdio-runtime.md)) — plugin process bên ngoài cung cấp tool/resource/prompt qua giao thức MCP. Per-agent whitelist roadmap pha 2 qua `agent.mcpServerIds`.

Khi spec viết, lý do tách là: "context provider = AWOG-native, MCP = third-party". Năm 2026 ranh giới này đã obsolete:

- 5/6 context provider có MCP server official sẵn:
  - `filesystem` → `@modelcontextprotocol/server-filesystem` (đã preset trong [ADR 0014](./0014-mcp-servers-stdio-runtime.md))
  - `gitnexus` → `gitnexus-mcp` (community)
  - `notion` → Notion MCP cloud
  - `jira` → Atlassian / Linear MCP
  - `slack` → `@modelcontextprotocol/server-slack`
  - `artifacts` ← chỉ thằng này AWOG-internal
- MCP đã wired pha 1 — lifecycle, enable toggle, runtime injection vào session đều OK.
- `agent.context` whitelist và `agent.mcpServerIds` whitelist là 2 cách phát biểu cùng concept "agent này được truy cập những data source nào".
- Build AWOG-native version cho 5/6 = duplicate effort vs ecosystem.

Giữ 2 feature dẫn tới:

- 2 picker overlap trong AgentEditor (Context Providers + Skills + future MCP picker).
- 2 mental model cho user ("provider" vs "MCP server" — không có lý do tách).
- 2 implementation song song cho cùng task (load Notion, etc.) — overhead bảo trì.

## Quyết định

**Bỏ hẳn Context Providers feature.** Mọi data source → đi qua MCP Servers. Per-agent whitelist → `agent.mcpServerIds` (pha 2 B3 từ [ADR 0014](./0014-mcp-servers-stdio-runtime.md)).

Cụ thể:

1. **Spec**: `docs/features/context-providers.md` chuyển status từ Draft → **Deprecated** với pointer sang `mcp-servers.md`.
2. **Type `Agent`** (sidecar `types/shared.ts` + UI `types/index.ts`): bỏ field `context: string[]`.
3. **Agent persistence**: `agents/store.ts buildAgent` silent-drop `context` từ frontmatter cũ (backwards-compat đọc, không round-trip). `saveAgent` không serialize `context` ra nữa. AGENT.md viết tay có `context: [...]` sẽ bị stripped khi save lại — chấp nhận vì field không có effect runtime.
4. **RPC schema** (`agents.upsert`, `agents.generate`): bỏ `context` khỏi zod.
5. **UI**: bỏ hẳn HTML comment + section CONTEXT PROVIDERS trong `AgentEditor.vue`. Bỏ `CONTEXT_PROVIDERS` const + `ContextProviderDef` interface trong `utils/initial-data.ts`. Bỏ `contextProviders` state trong `stores/settings.ts`.
6. **`agent.skillIds`** giữ nguyên — pha 2 sẽ wire (inject SKILL.md body vào systemPrompt). Skills feature đã có persistence + UI.
7. **`artifacts`** (workspace internal): xử lý qua Claude Code SDK native Read/Write/Edit tools (đã có sẵn, cwd = project path). Không cần MCP wrapper "awog-artifacts".

## Phương án đã cân nhắc

### Giữ Context Providers riêng cho non-MCP-shape sources

- **Từ chối:** chỉ còn 1 case (artifacts), và case đó đã được Claude Code SDK native tools handle. Build feature riêng cho 1 thằng = over-engineering.

### Fold context-providers vào MCP nhưng giữ `agent.context` field như alias

- **Từ chối:** alias field gây confusion khi đọc spec/code. Một concept → một field (`agent.mcpServerIds` ở pha 2).

### Migrate `context: ['notion']` → `mcpServerIds: ['notion-cloud']` tự động khi load

- **Từ chối:** chưa có chuẩn map "context slug → MCP server id" (user-defined). Tự động migrate có thể sai. Để user mở `~/.claude/agents/<id>.md` chỉnh tay nếu cần (rare case — pha 1 chưa enforce nên field hầu như rỗng).

## Hệ quả

- **Tích cực:**
  - 1 mental model: data source ngoài = MCP server.
  - UI cleaner: AgentEditor chỉ còn Name/Role/Description/Model/SystemPrompt/Skills. Pha 2 thêm MCP picker (thay vì 2 picker).
  - Bỏ ~3 tuần effort dự định cho Context Providers (xem [pha 2 backlog](../../README.md)).
  - Spec `docs/features/agent-builder.md` ngắn hơn — không phải maintain 2 mục dependency.
- **Tiêu cực / Trade-off:**
  - AGENT.md viết tay có `context: [...]` frontmatter sẽ bị silent-drop khi save lại qua AWOG. Mitigation: pha 1 chưa enforce field này nên hầu hết AGENT.md không set.
  - Phụ thuộc ecosystem MCP cho mọi data source — nếu user cần connector chưa có MCP server (vd. Trello), phải tự viết hoặc đợi community.
  - Settings → Connectors section sẽ trống cho đến khi UI MCP picker hoàn chỉnh ở pha 2.
- **Việc cần làm tiếp:**
  - Update `docs/features/context-providers.md` → Deprecated banner + redirect.
  - Code cleanup theo danh sách Q5 (Decision).
  - Update `docs/features/agent-builder.md` — bỏ Context Providers khỏi thuộc tính agent + phụ thuộc.
  - Update `docs/features/mcp-servers.md` — thêm note "absorbs former Context Providers feature".
  - Pha 2 B3 (per-agent MCP whitelist) bao trùm use case cũ của `agent.context`.

## Tham chiếu

- [docs/features/context-providers.md](../features/context-providers.md) — sẽ mark Deprecated.
- [docs/features/mcp-servers.md](../features/mcp-servers.md) — single source of truth cho data sources ngoài.
- [docs/features/agent-builder.md](../features/agent-builder.md) — bỏ tham chiếu.
- [ADR 0014 — MCP Servers stdio runtime](./0014-mcp-servers-stdio-runtime.md) — pha 2 B3 backlog.
- [ADR 0015 — Agents persistence](./0015-agents-persisted-runtime-systemprompt.md) — `agent.context` deferred → giờ removed.
