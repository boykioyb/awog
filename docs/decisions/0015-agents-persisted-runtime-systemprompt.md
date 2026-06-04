# 0015 — Agents: AGENT.md 5-tier persistence + systemPrompt runtime override

- **Trạng thái:** Accepted (pha 2A extensions 2026-05-29 — `agent.tools`, `agent.skillIds`, `agent.mcpServerIds` đã wire runtime, xem update bên dưới)
- **Ngày:** 2026-05-28
- **Người quyết định:** Tech Lead

> **Update 2026-05-29 (pha 2A):** Các field "defer pha 2" của ADR này đã implement:
> - **`agent.skillIds` runtime injection** (Sprint 1 A2) — `sessions.send-message` load skills first-match across 5 tiers, append body vào systemPrompt dưới header `# Available Skills`.
> - **`agent.tools`** (Sprint 1 A1) — Claude Code subagent field, forward thành `Options.allowedTools` cho SDK; agent chỉ thấy tool subset đã khai báo trong frontmatter.
> - **`agent.mcpServerIds`** (Sprint 2 B1) — per-agent MCP whitelist (replacement cho deprecated Context Providers — [ADR 0016](./0016-deprecate-context-providers-fold-into-mcp.md)). `sessions.send-message` intersect với session-level whitelist trước khi forward SDK option.
> - **AgentEditor source picker** (Sprint 3 C3) — dropdown "Save to" khi create new agent, options bao gồm cả project-tier per registered project.
> - **agent.context** đã bỏ hẳn ([ADR 0016](./0016-deprecate-context-providers-fold-into-mcp.md)).
>
> Multi-agent collab và per-agent model override vẫn defer pha 2B.

> **Update 2026-06-03 (gỡ skillIds):** `agent.skillIds` đã **bỏ hẳn** khỏi model Agent (UI type + sidecar type + frontmatter AGENT.md + agents.generate/author/upsert). Lý do: runtime injection chỉ ghép body skill vào `systemPrompt` (không dùng SDK-native skill, không progressive disclosure) → trùng mục đích với chính `systemPrompt`. Agent giờ định nghĩa bằng `systemPrompt` (+ `tools` + `mcpServerIds`). Skills vẫn tồn tại độc lập và là **task template per-node trong Workflows** (`node.skillId`, không liên quan agent). Workflow node **không còn auto-seed** skill từ agent — người dùng chọn skill cho node trong inspector (picker liệt kê toàn bộ skill workspace); `workflows.generate` nhận `availableSkills` toàn cục thay cho per-agent skills. Theo yêu cầu user (KISS/YAGNI).

## Bối cảnh

Tính năng [Agents](../features/agent-builder.md) đã có UI gần đầy đủ (page + 3 component + Pinia CRUD) nhưng **100% mock** — không có sidecar persistence và không ảnh hưởng runtime session khi gửi message.

Sau hai vòng thiết kế:

1. **Vòng 1 (deprecated)**: dự định 1-tier `~/.awog/agents/<id>.json` (theo pattern MCP — [ADR 0014](./0014-mcp-servers-stdio-runtime.md)). Đã implement rồi rút lại vì user yêu cầu project-level scope.
2. **Vòng 2 (chấp nhận)**: 5-tier như Skills (xem [type SkillSource trong shared.ts](../../apps/desktop/sidecar/src/types/shared.ts)) + format AGENT.md (frontmatter + body) tương thích Claude Code SDK subagent.

Cần chốt 3 quyết định:

1. **Persistence layout** — bao nhiêu tier, file format.
2. **Compat** — chuẩn vendor nào (Claude Code SDK / craft-agents-oss / AWOG-only)?
3. **Runtime effect** — agent ảnh hưởng session ở mức nào pha 1?

Ràng buộc:
- [.claude/rules/security.md](../../.claude/rules/security.md) — 8 invariant.
- [ADR 0001](./0001-local-first-storage.md) — filesystem là data layer.
- [ADR 0013](./0013-adopt-skill-md-format.md) — SKILL.md format đã chuẩn hoá frontmatter+body cho skills.

## Quyết định

### Q1. 5-tier AGENT.md — hỗ trợ cả 2 layout (single-file + folder)

Mirror chính xác phân tier của Skills. **Reader chấp nhận 2 layout** cho cùng dir:

- **Single-file** `<id>.md` — chuẩn Anthropic Claude Code docs.
- **Folder** `<id>/AGENT.md` — convention community sử dụng khi cần colocate sibling files (agent-memory, notes). Folder layout thắng nếu cả 2 cùng tồn tại.

**Writer mặc định single-file** cho agent mới AWOG tạo (khớp docs Anthropic). Nếu folder đã tồn tại sẵn (ví dụ agent imported từ repo dùng convention folder), writer ghi `AGENT.md` trong folder đó để bảo toàn sibling files. Tương tự delete/rename: detect folder trước, fallback single-file.

Path:

```
global         → ~/.awog/agents/<id>.md           (AWOG-native, default)
user-claude    → ~/.claude/agents/<id>.md         (Claude Code SDK subagents)
user-agents    → ~/.agents/agents/<id>.md         (Craft Agents)
project-claude → {project.path}/.claude/agents/<id>.md
project-agents → {project.path}/.agents/agents/<id>.md
```

- Mỗi agent unique theo tuple `(id, source, projectId)`.
- Slug `^[a-z0-9][a-z0-9-]{0,62}$`.
- Atomic write `.tmp` + rename; rename slug = `rename(<from>.md, <to>.md)`.
- Validate: zod ở RPC boundary; build từ frontmatter ở store boundary (giống `skills/store.ts buildSkill`).
- 3 user-tier always scanned; 2 project-tier yêu cầu `projectId` (resolve qua `loadProject`).

### Q2. Format Claude Code SDK subagent compatible

```yaml
---
name: Display Name              # required
description: One-sentence summary shown in pickers   # required
model: claude-sonnet-4-6        # optional, Claude Code field
role: BA                        # optional, AWOG extension
skillIds: ["a", "b"]            # optional, AWOG extension
context: ["artifacts"]          # optional, AWOG extension
---

You are a... <markdown body = systemPrompt>
```

Lý do:
- `name` + `description` required — match Claude Code SDK + UI picker contract.
- `model` standard Claude Code field.
- `role`, `skillIds`, `context` là AWOG-only mở rộng; vanilla Claude Code bỏ qua những field này (lossless cohabit).
- Body = systemPrompt — không lặp lại trong frontmatter, không JSON wrapper.
- Reuse `skills/frontmatter.ts` parser/serializer — không thêm dependency.

### Q3. Runtime: chỉ wire `agent.systemPrompt`, identify agent qua tuple

Tại `sessions.sendMessage`:

```ts
const Params = z.object({
  // …
  agent: z.object({
    id: z.string().min(1).max(64),
    source: z.enum(['global', 'user-claude', 'user-agents', 'project-claude', 'project-agents']),
    projectId: z.string().min(1).max(64).optional(),
  }).optional(),
})

let resolvedSystemPrompt = params.systemPrompt
if (params.agent) {
  const agent = await loadAgent(params.agent.id, params.agent.source, params.agent.projectId)
  if (agent?.systemPrompt) resolvedSystemPrompt = agent.systemPrompt
}
```

UI side: khi `session.invitedAgentIds.length === 1`, page sessions.ts tra `workspace.agentById(id)` → lấy `source`/`projectId` → gửi tuple. Multi-agent collab defer pha 2.

`agent.skillIds`, `agent.context`, `agent.model` **không** ảnh hưởng runtime pha 1 (giữ trong frontmatter, hiển thị UI, không enforce). Lý do giống vòng 1: phụ thuộc Skills + context-providers + per-agent UX chưa thiết kế.

### RPC methods (4)

| Method | Vai trò |
|---|---|
| `agents.list` | Params `{ projectIds? }` → `{ agents, reports }`. Scan 3 user-tier + 2 project-tier per id. Mỗi tier 1 ScanReport (giống Skills). |
| `agents.upsert` | Validate `(id, source, projectId)` tuple, mode `create | update`, optional `previousId` cho slug rename. |
| `agents.delete` | Unlink `<id>.md` ở tier xác định. |
| `agents.author` | Streaming LLM creator. System prompt liệt kê 5 tier path cho LLM chọn; LLM dùng Write tool ghi AGENT.md. Events `agents.author.chunk/step/done`. |

## Phương án đã cân nhắc

### 1-tier `~/.awog/agents/<id>.json` (vòng 1)

- **Từ chối**: user yêu cầu project-level. Không reuse được skill ở project (ví dụ team-shared agent trong repo).

### Folder + AGENT.md (giống skills SKILL.md)

- **Từ chối**: Claude Code SDK subagent format là single-file `.md`, không folder. Để compat ngược, theo single-file.

### Tools field (Claude Code allowed-tools list)

- **Defer pha 2**: AWOG hiện chưa wire per-agent tool whitelist. Field `tools` trong frontmatter sẽ được respect khi UI thêm tool picker.

### Sửa MCP servers cũng thành 5-tier

- **Từ chối**: MCP servers là plugin process — không có khái niệm "share qua git repo" rõ ràng như agent persona. Pattern khác nhau là đúng.

## Hệ quả

- **Tích cực:**
  - Reuse 100% pattern Skills (store + 5 tier + frontmatter parser).
  - File format swappable với Claude Code CLI — user mở `.claude/agents/<id>.md` trong Claude Code thấy subagent chạy bình thường.
  - Project-level agent commit qua git → team-shared mà không cần marketplace.
  - Future Claude Code subagent đặt sẵn ở `~/.claude/agents/` được AWOG tự nhặt lên.
- **Tiêu cực / Trade-off:**
  - File JSON đã được tạo trong vòng 1 (`~/.awog/agents/<slug>.json`) sẽ bị scanner mới bỏ qua (chỉ scan `.md`). User cần migrate thủ công nếu đã tạo agent. Pha 1 không tự migrate — note rõ.
  - Slug uniqueness là per-tier; UI cần phân biệt 2 agent cùng slug ở 2 tier khác nhau (đã giải bằng `agentKey()` composite).
  - `session.invitedAgentIds` vẫn lưu flat slug — multi-tier same-slug có thể resolve sai tier khi invite (acceptable pha 1; hiếm khi gặp).
- **Việc cần làm tiếp:**
  - Implement đã hoàn tất (R1..R8). Test thủ công.
  - Pha 2: wire `agent.skillIds → systemPrompt injection`, `agent.tools → SDK allowedTools`, `agent.context → connector whitelist`, multi-agent collab.

## Tham chiếu

- [docs/features/agent-builder.md](../features/agent-builder.md)
- [ADR 0013 — Adopt SKILL.md format](./0013-adopt-skill-md-format.md)
- [ADR 0014 — MCP servers stdio runtime](./0014-mcp-servers-stdio-runtime.md)
- [apps/desktop/sidecar/src/skills/store.ts](../../apps/desktop/sidecar/src/skills/) — pattern 5-tier đã port nguyên xi
- [apps/desktop/sidecar/src/agents/store.ts](../../apps/desktop/sidecar/src/agents/store.ts) — implementation pha 1
- [Claude Code SDK subagent docs](https://docs.claude.com/en/docs/claude-code/sub-agents) — định nghĩa AGENT.md format
