# 0051 — Progressive disclosure cho MCP tool (giảm context per-turn)

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-20
- **Người quyết định:** tech-lead + product owner

## Bối cảnh

Mỗi turn, runtime AWOG lắp lại toàn bộ tool set qua `createRuntimeToolDefinitions`
([runtime/tools/index.ts](../../apps/desktop/sidecar/src/runtime/tools/index.ts)).
Với MCP, `createMcpToolDefinitions` → `listServerTools` gọi `tools/list` rồi
`synthTool` sinh **một AgentTool cho mỗi MCP tool, kèm full `inputSchema`** bọc
`Type.Unsafe`
([runtime/tools/mcp-tools.ts:573](../../apps/desktop/sidecar/src/runtime/tools/mcp-tools.ts#L573)).
Cả `N` schema này nằm trong `context.tools` **mỗi turn**.

Khảo sát runtime (2026-06-20) cho thấy đây là bề mặt **eager-load** lớn nhất còn lại:

- **Skills** đã lazy — chỉ load khi `node.skillId` gọi.
- **Commands** đã lazy — expand client-side khi user gõ `/name`.
- **systemPrompt append** (style/plan/todo/mcp-note) đã conditional.
- **Rules** eager mỗi turn nhưng nhỏ (~200 token/rule) — xử lý ở ADR 0050.
- **MCP tool schema**: ~1.5–4k token/server; nhiều server → 8–13k mỗi turn. Và
  `tools/list` lặp lại **mỗi turn** (session pool chỉ tái dùng *connection*, không
  cache *kết quả list* — [mcp-tools.ts:540](../../apps/desktop/sidecar/src/runtime/tools/mcp-tools.ts#L540)).

Chi phí này chiếm chỗ trong cửa sổ ngữ cảnh (200k) bất kể prompt cache — cache chỉ
giảm tiền, không giảm chỗ chiếm.

**Ràng buộc cứng:**

1. Pi SDK **không** cho đăng ký/đổi tool động *giữa* một `runAgentLoop` — tool list
   cố định cho cả turn (nhiều model-turn). Mọi giải pháp phải nằm ở **tầng AWOG**.
2. Phải giữ nguyên các invariant hiện có:
   - Filter `allowedTools`/`disabledTools` + `bypassAllowlistMcpServerIds` cho
     subagent kế thừa MCP của parent ([ADR 0030](0030-subagent-task-tool.md)).
   - Permission gate `beforeToolCall` đang gate theo tên `mcp__<id>__<tool>`.
   - Trace/step map theo tên `mcp__<id>__<tool>`.
   - Secret/headers/args không rò ra log/UI (invariant 1).

## Quyết định

Áp dụng **progressive disclosure cho MCP tool ở tầng AWOG, gate theo ngưỡng kích
thước schema** (kết hợp cơ chế "proxy meta-tools" với chính sách "chỉ bật khi cần").

**Cơ chế (proxy meta-tools):** khi tổng schema MCP của turn vượt ngưỡng
(`MCP_PROXY_THRESHOLD_BYTES`, mặc định ~6KB serialized, tunable), thay vì sinh `N`
tool trực tiếp, runtime đưa vào loop:

- **Catalog gọn** nối vào `systemPromptAppend`: mỗi server liệt kê `serverId` +
  tên tool + 1 dòng `description`, **không có schema**. (~50–150 token/server.)
- Meta-tool **`mcp_describe(server, tool)`** → trả full JSON input schema của đúng
  một tool, on-demand.
- Meta-tool **`mcp_call(server, tool, arguments)`** → execute, **tái dùng đúng
  execute path của `synthTool`** (leaseTransport + `tools/call` + mapResultContent),
  giữ nguyên session pool, abort, clip, isError semantics.

**Dưới ngưỡng → giữ NGUYÊN hành vi hiện tại** (tool trực tiếp, typed). Common case
(0–2 server, ít tool) không đổi một dòng hành vi → 0 rủi ro ergonomics.

**tools/list cache:** cache `RawMcpTool[]` theo `(poolKey, serverId, configKey)`
qua các turn → bỏ RPC lặp + giữ catalog/threshold ổn định cho prompt cache. Invalidate
khi `configKey` đổi hoặc child chết (đã có sẵn tín hiệu ở pool).

**Bảo toàn invariant trên proxy path:**

- **Filter:** catalog chỉ liệt kê tool *được phép* (apply `allowedTools` /
  `disabledTools` / `bypassAllowlistMcpServerIds` theo tên `mcp__<id>__<tool>` như
  cũ). `mcp_call` **re-validate** `(server, tool)` trước khi execute → reject nếu bị
  deny (không tin model gọi đúng phạm vi).
- **Permission gate:** `beforeToolCall` special-case `mcp_call` — đọc `server`/`tool`
  trong args để prompt y như per-tool (giữ UX permission, không gộp thành một "mcp_call"
  mờ).
- **Trace/step:** `step-mapper`/`trace-mapper` special-case `mcp_call` → render
  `server: tool` từ args (không hiện "mcp_call" trơ).
- **Secret:** meta-tool không log args (`params` có thể chứa input nhạy cảm) — như
  `synthTool` hiện tại.

## Phương án đã cân nhắc

- **2A always-proxy (proxy mọi lúc)** — *từ chối.* Over-apply: ép cả session 1
  server đi đường describe→call, hại ergonomics khi chẳng có vấn đề context. Ngưỡng
  hoá khắc phục đúng nhược điểm này.
- **2B cross-message deferred (kích hoạt theo message)** — *từ chối.* Vì Pi cố định
  tool list trong loop, tool vừa "kích hoạt" chỉ gọi được từ **message kế tiếp** →
  hỏng cho phiên agentic multi-step trong một lượt.
- **2C sửa/fork Pi SDK (đăng ký tool động giữa loop)** — *hoãn.* Cho ergonomics tốt
  nhất (typed tool + on-demand) nhưng đụng third-party dep, rủi ro cao, công lớn. Giữ
  làm hướng tương lai nếu đo cho thấy proxy path làm giảm chất lượng đáng kể.
- **Always-direct + trim schema** — bất khả: cắt schema làm model gọi sai args.

## Hệ quả

- **Tích cực:**
  - Session nhiều MCP tool: context per-turn giảm mạnh (`N` schema → catalog + 2
    meta-tool, schema lấy on-demand vào history chỉ cho tool thực sự dùng).
  - `tools/list` không còn lặp mỗi turn (perf + ổn định prompt cache).
  - Common case giữ nguyên typed tool — không hồi quy.
- **Tiêu cực / Trade-off:**
  - Proxy path: thêm round-trip `mcp_describe` → `mcp_call`; model gọi proxy "kém tự
    nhiên" hơn typed tool (rủi ro chất lượng — cần đo).
  - Hai code path (direct vs proxy) → phức tạp hơn; nhưng proxy path cô lập sau
    ngưỡng, direct path không đổi.
  - Permission/trace/step phải special-case `mcp_call` (nếu thiếu → UX permission gộp
    + trace hiện "mcp_call" trơ).
- **Việc cần làm tiếp:**
  - Chốt `MCP_PROXY_THRESHOLD_BYTES` thực tế sau khi đo.
  - Instrument breakdown context-window trong UI usage (system/tools/rules/messages/
    free) để **verify** mức giảm — đo trước/sau (xem [[project_usage_cache_tokens]]).
  - [ADR 0050](0050-rules-relevance-filter.md) — rules relevance filter (phần nhẹ).
  - Cân nhắc 2C nếu proxy path ảnh hưởng chất lượng.

## Tham chiếu

- [ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md) — Pi SDK runtime
- [ADR 0030](0030-subagent-task-tool.md) — subagent MCP inheritance (bypass filter)
- [ADR 0014](0014-mcp-servers-stdio-runtime.md), [ADR 0018](0018-mcp-secret-keychain.md), [ADR 0025](0025-connections-manager.md) — MCP/Connections
- [ADR 0033](0033-rules-system-prompt-injection.md) — rules injection (nền cho 0050)
