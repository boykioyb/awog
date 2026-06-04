# Plan: Pha 2A — Skills runtime + MCP per-agent + UX polish

**Trạng thái: ✅ Implemented (2026-05-29)**

> Sprint 1 (~1 tuần): items effort S/M, deliver fast. ✅
> Sprint 2 (~2 tuần): items effort M/L cần research nhiều hơn. ✅
> Sprint 3 (~3-5 ngày): polish + edge case. ✅
>
> 10/10 task xong. Tổng: 1 ADR mới (0018), +15 file mới, +25 file sửa.
>
> Backlog Pha 2B + xa hơn: xem [Phase 2 summary](../decisions/0016-deprecate-context-providers-fold-into-mcp.md) + [ADR 0014](../decisions/0014-mcp-servers-stdio-runtime.md) B4/B5/B7/B8.

## Sprint 1 — Agent runtime polish + UX (4-5 ngày)

### ✅ A1. Parse + inject `agent.tools` field — **S**
**Vấn đề:** AGENT.md viết tay (vd. vtv-shop-b2b/.claude/agents/ba/AGENT.md) có frontmatter `tools: [Read, Grep, Bash, ...]` nhưng AWOG silent-drop khi build agent. Tools không pass xuống SDK → agent không bị restrict tool.

**Files:**
- `sidecar/src/types/shared.ts` — `Agent` add `tools?: string[]`
- `sidecar/src/agents/store.ts` `buildAgent` parse `data.tools`, `saveAgent` serialize
- `sidecar/src/methods/agents.upsert.ts` zod schema `tools: StringArray.optional()`
- `sidecar/src/methods/sessions.send-message.ts` — khi resolve agent, pass `agent.tools` → `runStream({ allowedTools })`
- `sidecar/src/sessions/runner.ts` `buildOptions` thêm `allowedTools` param → `opts.allowedTools`
- `ui/types/index.ts` — `Agent.tools?: string[]`
- `ui/components/agent/AgentDetail.vue` — hiển thị tools chip row (read-only)

**AC:** Mời agent có tools=[Read, Grep] vào session, gửi message → SDK chỉ thấy Read + Grep, không thấy Edit/Write/Bash.

### ✅ A2. `agent.skillIds` runtime injection — **M**
**Vấn đề:** Agent có skillIds=[...] nhưng nội dung SKILL.md không append vào systemPrompt khi agent active.

**Files:**
- `sidecar/src/skills/store.ts` thêm helper `loadSkillsByIds(ids: string[], projectIds: string[])` — first-match across all 5 tiers
- `sidecar/src/methods/sessions.send-message.ts` — khi `agent` resolve OK, load skillIds → append vào `resolvedSystemPrompt`
  - Format: `<original prompt>\n\n---\n\n# Available Skills\n\n## Skill: <name>\n\n<body>\n\n## Skill: ...`
- Skills not found → log warning, skip
- Empty skillIds → no append

**AC:** Agent X có skillIds=['code-review'], skill 'code-review' tồn tại với body markdown → session message → response phản ánh được nội dung skill body (vd. nếu skill nói "luôn check security", agent reply có security check).

### ✅ A3. Toast notifications cho agents CRUD — **S**
**Vấn đề:** Skills page có toast (success/error) cho save/delete/refresh, Agents không.

**Files:**
- `ui/pages/agents/index.vue` — copy `pushToast` + `toasts` + `toastStyle` từ `pages/skills/index.vue`
- Wire toast vào `onSave`, `onDelete`, `onDuplicate`, `commitRename`, `onApplyBodyEdit`, `refresh`

**AC:** Tạo/xoá/sửa/duplicate agent → toast popup góc dưới-phải 3.2s.

### ✅ A4. Bulk delete cho agents — **S**
**Vấn đề:** Skills page có bulk-select checkbox + floating delete bar, Agents không.

**Files:**
- `ui/pages/agents/index.vue` — copy bulk pattern từ Skills:
  - `bulkSelection: Set<string>` (composite agentKey)
  - Checkbox column trong list row
  - "Select all" header bar
  - Floating action bar khi `bulkSelection.size > 0`
  - `confirmBulkDelete` sequential delete + result toast

**AC:** Tick 3 agent → "Delete 3" → confirm → 3 files biến mất khỏi disk, toast "Deleted 3 agents".

## Sprint 2 — MCP per-agent + transport http + secret (~2 tuần)

### ✅ B1. `agent.mcpServerIds` field + per-agent MCP whitelist — **M**
**Vấn đề:** ADR 0016 đã chốt thay Context Providers bằng MCP per-agent whitelist. Hiện session inject TẤT CẢ enabled stdio MCP server, không lọc theo agent.

**Files:**
- `sidecar/src/types/shared.ts` — `Agent.mcpServerIds?: string[]`
- `sidecar/src/agents/store.ts` — parse/serialize
- `sidecar/src/methods/agents.{upsert,generate}.ts` — zod schema
- `sidecar/src/methods/sessions.send-message.ts` — khi build `mcpServersForSdk`, intersect với `agent.mcpServerIds` nếu set (giống pattern session.mcpServerIds đã có)
- `ui/types/index.ts` — `Agent.mcpServerIds?: string[]`
- `ui/components/agent/AgentEditor.vue` — **thêm MCP picker section** thay cho Context Providers cũ đã xoá; render từ `ws.mcpServers` (đã hydrate); checkbox list
- `ui/components/agent/AgentDetail.vue` — hiển thị active MCP servers
- `ui/components/agent/AgentBodyEditModal.vue` — preserve `mcpServerIds` khi apply

**AC:** Agent X có mcpServerIds=['filesystem'], session invite X, gửi message → SDK chỉ thấy filesystem MCP tools, không thấy github/notion.

### ✅ B2. MCP secret injection qua OS keychain — **M**
**Vấn đề:** Hiện env vars trong MCP config (vd. `GITHUB_PERSONAL_ACCESS_TOKEN`) lưu plaintext trong `~/.awog/mcp-servers/<id>.json`. Insecure.

**Files:**
- Thêm dependency `keytar` hoặc `node-keychain` (need ADR cho dep mới)
- `sidecar/src/credentials/keychain.ts` — wrapper API: `setSecret(key, value)`, `getSecret(key)`, `deleteSecret(key)`
- `sidecar/src/mcp/store.ts` — khi save, detect env value khớp pattern `${secret:NAME}` → lưu raw value vào keychain với key `mcp/<server-id>/<env-name>`, JSON chỉ giữ placeholder
- `sidecar/src/methods/sessions.send-message.ts` (hoặc McpManager spawn) — khi build env cho child process, expand `${secret:NAME}` từ keychain
- UI `McpEditor.vue` — input env value: nếu detect token-shape → cho user opt-in "Store in keychain" checkbox; placeholder display `••••••` cho secret đã store
- ADR mới `0017-mcp-secret-keychain.md`

**AC:** User nhập GITHUB_PAT vào McpEditor, save → JSON file chứa `${secret:GITHUB_PERSONAL_ACCESS_TOKEN}` (không có token raw), keychain có entry tương ứng. Restart app → MCP server vẫn auth GitHub OK.

### ✅ B3. MCP transport `http` — **L**
**Vấn đề:** Pha 1 chỉ stdio. Notion cloud, Linear, một số MCP remote không có stdio binary.

**Files:**
- `sidecar/src/mcp/schema.ts` — `url`, `headers` fields đã có, gỡ check "transport-not-supported" cho http
- `sidecar/src/mcp/manager.ts` — thêm `HttpMcpClient` class song song `StdioMcpClient`; `start()` for http = pure fetch session, không spawn process; lifecycle khác (no crash backoff, just connection retry on call)
- `sidecar/src/mcp/manager.ts` — SSRF guard: validate `URL.host` ∈ allowlist (default empty, user thêm qua settings)
- `sidecar/src/methods/mcp.test.ts` — http handshake (POST `initialize`)
- `sidecar/src/methods/sessions.send-message.ts` — build mcpServersForSdk cũng include http servers với `type: 'http'`
- `ui/components/mcp/McpEditor.vue` — http transport form (url + headers KV editor) đã có UI từ pha 1, just need wire
- Update ADR 0014 — pha 2 enable http

**AC:** User add MCP server transport='http' url='https://mcp.notion.com/v1' headers={Authorization: 'Bearer ${secret:notion_token}'}, Test → kết nối OK + list tools.

## Sprint 3 — Polish + sandbox + filesystem watcher (~1 tuần)

### ✅ C1. Filesystem watcher trong sidecar — **M**
**Vấn đề:** User viết tay `.md`/`.json` ngoài app → phải click Refresh. Skills/Agents/MCP pages cần auto-detect.

**Files:**
- Thêm dep `chokidar` (ADR mới)
- `sidecar/src/watcher.ts` — watch `~/.awog/`, `~/.claude/agents`, `~/.agents/agents`, project `.claude/agents/`, `.agents/agents/`; debounce 500ms
- Emit events: `agents.changed`, `skills.changed`, `mcp-servers.changed`
- UI subscribe ở store: re-hydrate khi event đến
- Toggle setting để user disable nếu watcher consume CPU

**AC:** User viết file mới `~/.awog/agents/my-new.md` từ terminal → UI agents page (nếu đang mở) tự refresh trong < 1s.

### ✅ C2. MCP B6 idle stop — **S**
**Vấn đề:** Pha 1 mọi enabled MCP server giữ chạy. Lazy server với `autoStart: false` không spawn lazy thực sự.

**Files:**
- `sidecar/src/mcp/manager.ts` — track `lastToolCall: timestamp` per server; setInterval check 60s; nếu autoStart=false + idle > 5min → stop
- Trên next tool call (qua SDK lifecycle) → tự re-spawn

**AC:** Server với autoStart=false, không có call → sau 5 phút check Process → đã tắt. Gửi session message dùng server đó → spawn lại, gọi tool OK.

### ✅ C3. AgentEditor source/projectId picker — **S**
**Vấn đề:** Tạo agent mới qua form luôn lưu `source: 'global'`. User muốn save vào `.claude/agents` của project cụ thể phải qua LLM creator hoặc viết tay.

**Files:**
- `ui/components/agent/AgentEditor.vue` — khi `props.agent === null` (mode create), add dropdown "Save to" với options:
  - `Global (~/.awog/agents/)`
  - `Claude Code shared (~/.claude/agents/)`
  - `Craft Agents shared (~/.agents/agents/)`
  - Per project: `<project.name> · .claude/agents/`
  - Per project: `<project.name> · .agents/agents/`
- Update `makeDefaults` để derive source từ dropdown selection

**AC:** Create agent → chọn "vtv-shop-b2b · .claude/agents/" → save → file xuất hiện ở `/Users/.../vtv-shop-b2b/.claude/agents/<slug>.md`.

## DAG

```
A1 (tools) ──┐
             ├─→ A3 (toast) ─→ A4 (bulk delete) ──┐
A2 (skills) ─┘                                    ├─→ Sprint 1 done
                                                  │
B1 (agent mcpIds) ─→ B2 (keychain) ─→ B3 (http) ──┤
                                                  ├─→ Sprint 2 done
C1 (watcher) ──┐                                  │
C2 (idle stop) ├─→ C3 (source picker) ────────────┤
               │                                  ├─→ Sprint 3 done
               │                                  │
               └─ Pha 2B (multi-agent, MCP B4-B5-B7-B8, Sessions polish, vitest)
```

## Backlog defer Pha 2B

- MCP B4 sandbox stdio (macOS sandbox-exec / Linux namespace) — L
- MCP B5 hot reload schema — M
- MCP B7 persistent McpManager process (UI status 100% live) — L
- MCP B8 remote registry discovery — M
- Multi-agent collab trong 1 turn — L
- Sessions multimodal/persist steps/multi-provider/search/fork — L
- Per-agent model + API key override — M
- Vitest setup + automated tests — L
- Round-trip unknown frontmatter — S

Tổng pha 2B: ~4-5 tuần dev.
