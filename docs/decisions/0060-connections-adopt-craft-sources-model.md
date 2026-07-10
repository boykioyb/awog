# 0060 — Connections áp dụng mô hình "Sources" của Craft (mcp/api/local + OAuth + per-source folder)

- **Trạng thái:** Accepted
- **Ngày:** 2026-07-10
- **Người quyết định:** User (chủ dự án) + Tech Lead
- **Liên quan:** Supersede phần "đơn giản hoá" của [ADR 0025](./0025-connections-manager.md); dùng [ADR 0018](./0018-mcp-secret-keychain.md) (keychain), [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md) (Pi runtime), [ADR 0014](./0014-mcp-servers-stdio-runtime.md) (MCP stdio/http).

## Bối cảnh

[ADR 0025 (Amended)](./0025-connections-manager.md) cố tình **đơn giản hoá** Connections thành một danh sách MCP server phẳng, global-only, chỉ transport stdio/http — viện dẫn Craft "Sources" như mô hình *đơn giản*. Thực tế sau khi khảo sát toàn bộ [craft-agents-oss](https://github.com/lukilabs/craft-agents-oss) (`v0.11.0`, clone local tại `/Users/kyro/KyroTech/Projects/craft-agents-oss`), mô hình **Sources đầy đủ** của Craft **phong phú hơn nhiều** so với Connections hiện tại của AWOG.

User chốt **port đầy đủ** mô hình Sources để AWOG bám sát craft-agents-oss làm chuẩn tham chiếu (xem lịch sử quyết định trong hội thoại 2026-07-10). Đây là điểm khởi phát từ một sự cố cụ thể: user cấu hình "VPS connection" bằng `command: ssh <host>` làm stdio MCP → lỗi `-bash: line 1: jsonrpc:2.0: command not found` (JSON-RPC handshake bị đẩy vào bash shell thay vì một MCP server). Kết luận: **Craft không có khái niệm "SSH/VPS connection"** — nguồn remote của Craft là MCP-qua-HTTP hoặc REST-API có OAuth/token; VPS đúng cách là chạy MCP server trên VPS rồi nối qua HTTP.

## Quyết định

Đổi khái niệm **"Connection = MCP server phẳng"** thành **"Source"** theo mô hình Craft, gồm 3 loại và hạ tầng auth/storage đi kèm.

### D-1 — Discriminated `SourceType`: `mcp | api | local`

`McpServerConfig` (một biến thể transport) → `SourceConfig` discriminated theo `type`:

| `type` | Ý nghĩa | Trở thành tool thế nào |
|---|---|---|
| `mcp` | MCP server remote (http/sse) hoặc local (stdio) | `tools/list` → mỗi tool = `mcp__<slug>__<tool>` |
| `api` | REST API | 1 tool `api_<slug>` (path/method/params) — dựng bằng **Pi `AgentTool`** in-process |
| `local` | Thư mục filesystem | không sinh MCP tool; agent dùng fs/bash tool bị giới hạn theo `local.path` |

`transport` (stdio/http/sse) trở thành field **bên trong** block `mcp`, không còn là trục biến thể top-level.

### D-2 — Storage: per-source folder

`~/.awog/mcp-servers/<id>.json` (một file) → **`~/.awog/sources/<slug>/`**:

```
~/.awog/sources/<slug>/
  ├── config.json        # SourceConfig (bắt buộc)
  ├── guide.md           # hướng dẫn agent (tùy chọn) — inject vào context
  ├── permissions.json   # override quyền Explore mode (tùy chọn)
  └── icon.{svg,png,jpg}  # icon local (tùy chọn)
```

Theo precedent folder-layout của Agents ([agents/store.ts](../../apps/desktop/sidecar/src/agents/store.ts)). **Global-only** (không tier project — giữ đơn giản như ADR 0025 D-3 đã revert). Có **migration** đọc `mcp-servers/<id>.json` cũ → folder `sources/<slug>/` (idempotent, chạy lúc boot).

### D-3 — Vòng đời: bỏ `autoStart` + idle-stop-config; trạng thái theo test/auth

Craft **không có** `autoStart` lẫn idle-stop cấu-hình-được. Kết nối do **pool lazy** quản (connect khi source active trong session, reconnect khi config/token đổi, disconnect khi bỏ). AWOG **đã có** pool session-scoped ở [mcp-tools.ts](../../apps/desktop/sidecar/src/runtime/tools/mcp-tools.ts) (keyed `sessionId`, idle 15'), nên:

- **Bỏ** field `autoStart` + `McpManager` idle-stop-config + vòng đời "process thường trực" nuôi status.
- Trạng thái hiển thị = **kết quả test/auth gần nhất**, persist trong `config.json`:
  - `connectionStatus: 'connected' | 'needs_auth' | 'failed' | 'untested' | 'local_disabled'`
  - `isAuthenticated?: boolean`, `connectionError?: string`, `lastTestedAt?: number`
- `enabled: boolean` **giữ nguyên** (Craft cũng có; `source.test` auto-enable khi test sạch).

### D-4 — Auth: OAuth + token-refresh, credential lưu bằng **keychain AWOG** (chệch khỏi Craft — user chốt)

Bổ sung ngoài `secret:KEY` header tĩnh:
- **OAuth cho remote MCP**: auto-discovery RFC 9728 (+ fallback RFC 8414) + PKCE S256 + Dynamic Client Registration + loopback callback (cổng 8914–8924). Tái dùng [auth/pkce.ts](../../apps/desktop/sidecar/src/auth/pkce.ts), [auth/oauth-flow-store.ts](../../apps/desktop/sidecar/src/auth/oauth-flow-store.ts), pattern loopback của [auth.start-oauth-codex.ts](../../apps/desktop/sidecar/src/methods/auth.start-oauth-codex.ts).
- **Generic OAuth cho `api`** (explicit endpoint hoặc auto-discovery) + Google/Microsoft/Slack (phase sau).
- **Auto token-refresh** (mirror `TokenRefreshManager`): refresh trước khi hết hạn 5', inject `Authorization: Bearer <token>` lúc connect; renew-endpoint cho API non-OAuth.

**Chệch khỏi Craft (user xác nhận 2026-07-10):** Craft lưu credential trong file tự-mã-hoá `credentials.enc` (khoá PBKDF2 từ machine-id). AWOG **tái dùng OS keychain** (`@napi-rs/keyring`, [keychain.ts](../../apps/desktop/sidecar/src/credentials/keychain.ts)) + `credentials.json` (chmod 600), giữ **invariant #1** (credential không rời sidecar). Không port `credentials.enc`.

### D-5 — Permissions per-source (Explore mode)

`permissions.json` mỗi source: `allowedMcpPatterns` (**auto-scope** `mcp__<slug>__*` — source chỉ whitelist tool của chính nó), `allowedApiEndpoints`, `allowedBashPatterns`, `allowedWritePaths`. Merge additive: hardcoded read-only → default app → workspace → mỗi active source. **Bật thực thi thật** (hiện AWOG persist `trust` nhưng chưa enforce — [schema.ts:52](../../apps/desktop/sidecar/src/mcp/schema.ts)); nối vào permission gate của runtime.

### D-6 — `source.test` per-kind

`mcp.test` → `source.test`: mcp (handshake + tools/list, phân loại 401/403 = `needs_auth`) / api (ping `testEndpoint` có auth) / local (path reachable) + tự download icon URL + auto-enable khi sạch.

### D-7 — UX add-source: giữ **cả** AI creator **và** form (chệch khỏi Craft — user chốt)

Craft chỉ có AI-authored (agent tự viết `config.json`). AWOG đã có cả `mcp.author` (AI) lẫn `ConnectionEditor` (form) → **giữ cả hai** (superset). `mcp.author` → `source.author`.

### D-8 — API-source tool chạy trên CẢ HAI runtime (Pi + Claude SDK)

AWOG có 2 runtime (ADR 0058): **Pi** (OpenAI/Google/custom) và **Claude Agent SDK** (anthropic — runtime người dùng dùng ~90%). `api` source phải chạy trên **cả hai**.

- **Đường Pi:** dựng tool `api_<slug>` bằng **`AgentTool` của Pi** (tiền lệ wrap MCP tool trong [mcp-tools.ts](../../apps/desktop/sidecar/src/runtime/tools/mcp-tools.ts)).
- **Đường Claude SDK:** cơ chế chính thống để cấp in-process tool cho SDK **là** `createSdkMcpServer`/`tool` của `@anthropic-ai/claude-agent-sdk` → dựng một in-process SDK MCP server per api source (name = `source.id`, tool = `api_<slug>` → phơi ra `mcp__<id>__api_<slug>`, khớp Pi + whitelist/permission/trace) và merge vào `options.mcpServers`.

**Lõi request dùng chung:** cả hai runtime gọi cùng một `executeApiCall(source, {path,method,params})` (auth/oauth inject + SSRF + cap) trong [sources/api-tools.ts](../../apps/desktop/sidecar/src/runtime/tools/../../sources/api-tools.ts) — một implementation duy nhất.

> **Đính chính (2026-07-10):** phiên bản đầu của D-8 nói "chỉ Pi, không import Anthropic SDK" — SAI về hệ quả (api source mất trên đường anthropic, tức 90% use-case). Cấm import Anthropic SDK chỉ áp cho **đường Pi**; đường Claude SDK **được** dùng `createSdkMcpServer` (đó là SDK của chính Anthropic). Đã sửa trong commit `adcb73f`.

**Còn lệch (SDK):** per-call `allowedApiEndpoints` (P4, chặn non-GET theo path) hiện chỉ enforce ở đường Pi (`createApiTool`); đường SDK enforce tool-level `mcp__<id>__*` + trust nhưng chưa soi path/method. Follow-up: truyền endpoint rules vào `buildApiSdkServers` để check trong handler.

## Phương án đã cân nhắc

- **A — Full port mô hình Sources (CHỌN):** giống hệt Craft về khái niệm + UX, chệch 2 điểm hạ tầng (keychain, Pi). Pros: bám chuẩn tham chiếu, giải quyết đúng use-case remote (khỏi SSH hack), permission thật. Cons: feature lớn, nhiều phase, đảo ADR 0025.
- **B — Chỉ thêm OAuth cho http MCP + polish UX:** nhỏ hơn nhưng không có `api`/`local`/permissions → không "giống hệt". Bị bác (user muốn full).
- **C — Chỉ đồng bộ UI:** không giải quyết chức năng. Bị bác.

## Hệ quả

### Tích cực
- Kết nối remote đúng cách (MCP-over-HTTP + OAuth) → hết SSH hack + lỗi `jsonrpc:2.0: command not found`.
- 3 loại nguồn (mcp/api/local) + permission Explore-mode thật.
- Vòng đời gọn hơn (một pool lazy, bỏ vòng đời process thường trực song song).

### Tiêu cực / rủi ro
- Đảo ADR 0025 (đã note trong ADR 0025 + memory). Migration bắt buộc chuẩn (không mất config cũ).
- Hai resolver runtime phải đồng bộ (sessions + tasks) khi thêm kind/auth mới.
- Sidecar đổi lớn → nhớ rebuild `dist` + restart app khi dev (UI hot-reload dễ gây nhầm).

## Triển khai

Chi tiết + phân rã theo phase (P0..P6) + acceptance: [docs/features/connections-sources-model.md](../features/connections-sources-model.md).
