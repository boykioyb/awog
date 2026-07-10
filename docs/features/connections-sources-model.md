# Feature — Connections áp dụng mô hình "Sources" của Craft

> Spec triển khai cho [ADR 0060](../decisions/0060-connections-adopt-craft-sources-model.md). Đọc ADR trước để nắm *vì sao*.
>
> **Tham chiếu code:**
> - Craft (clone local): `/Users/kyro/KyroTech/Projects/craft-agents-oss` — mô hình ở `packages/shared/src/sources/`, `packages/shared/src/mcp/`, `packages/shared/src/auth/`, `packages/session-tools-core/src/handlers/`, UI ở `apps/electron/src/renderer/{pages,components}/`.
> - AWOG hiện tại: sidecar `apps/desktop/sidecar/src/mcp/`, `runtime/tools/mcp-tools.ts`, `methods/mcp.*`; UI `apps/desktop/ui-next/{pages/connections.vue,components/connection/*,stores/connections.ts,composables/useConnectionsPage.ts}`.

## Mục tiêu

Thay "Connection = MCP server phẳng" bằng **Source** 3 loại (`mcp | api | local`) + per-source folder + OAuth/token-refresh + permission Explore-mode, bám sát craft-agents-oss (chệch 2 điểm: dùng keychain AWOG thay `credentials.enc`; giữ cả AI creator lẫn form).

## Từ vựng

- **Source**: đơn vị kết nối nguồn ngoài (thay "Connection"). `slug` = định danh (tên folder).
- **Kind**: `type` của source (`mcp`/`api`/`local`).
- **Pool**: `McpClientPool` lazy — connect khi source active trong session, reconnect khi config/token đổi.

## Data model đích (`SourceConfig`)

Discriminated union theo `type`. Nguồn chân lý validation = Zod ở sidecar; TS mirror ở `types/shared.ts` + UI type ở `stores/connections.ts` (đổi tên `McpServer` → `Source`).

```ts
type SourceType = 'mcp' | 'api' | 'local'
type SourceConnectionStatus =
  | 'connected' | 'needs_auth' | 'failed' | 'untested' | 'local_disabled'

interface SourceConfigBase {
  id: string            // `${slug}_${8hex}` (ổn định, không đổi)
  slug: string          // ^[a-z0-9-]+$ — tên folder, unique
  name: string
  provider: string      // freeform hoặc KnownProvider (google/microsoft/linear/github/notion/slack/exa)
  enabled: boolean
  type: SourceType
  icon?: string         // emoji | URL (auto-download) | ./icon.svg
  tagline?: string      // blurb ngắn cho context agent
  description?: string
  // status (cập nhật bởi source.test / auth):
  isAuthenticated?: boolean
  connectionStatus?: SourceConnectionStatus
  connectionError?: string
  lastTestedAt?: number
  createdAt?: number
  updatedAt?: number
  timeoutMs: number     // handshake/probe budget (giữ từ McpServerConfig)
  deniedTools?: string[]
  trust: 'allow' | 'prompt' | 'deny'
  healthCheck?: { tool: string; args?: Record<string, unknown> }  // mcp-only probe
}

interface McpSource extends SourceConfigBase {
  type: 'mcp'
  mcp: {
    transport?: 'http' | 'sse' | 'stdio'   // default 'http'
    // http/sse:
    url?: string
    authType?: 'oauth' | 'bearer' | 'none'
    clientId?: string                       // OAuth client id (non-secret)
    headers?: Record<string, string>        // secret:KEY refs
    headerNames?: string[]                  // multi-header credential names
    // stdio:
    command?: string
    args?: string[]
    env?: Record<string, string>            // secret:KEY refs
  }
}

interface ApiSource extends SourceConfigBase {
  type: 'api'
  api: {
    baseUrl: string                          // BẮT BUỘC trailing slash
    authType: 'bearer' | 'header' | 'query' | 'basic' | 'oauth' | 'none'
    headerName?: string                      // default 'x-api-key'
    headerNames?: string[]                   // multi-header
    queryParam?: string                      // default 'api_key'
    authScheme?: string                      // default 'Bearer' ('' = raw)
    defaultHeaders?: Record<string, string>
    testEndpoint?: { method: 'GET'|'POST'; path: string; body?: object; headers?: Record<string,string> }
    renewEndpoint?: { path: string; method?: 'GET'|'POST'; body?: object; headers?: Record<string,string>; tokenField?: string; expiresInField?: string; fallbackTtlSecs?: number }
    oauth?: { authorizationUrl: string; tokenUrl: string; clientId: string; clientSecret?: string; scopes?: string[]; audience?: string; extraParams?: Record<string,string> }
    // provider-specific (phase P6):
    googleService?: 'gmail'|'calendar'|'drive'|'docs'|'sheets'|'youtube'|'searchconsole'
    googleScopes?: string[]; googleOAuthClientId?: string; googleOAuthClientSecret?: string
    slackService?: 'messaging'|'channels'|'users'|'files'|'full'; slackUserScopes?: string[]
    microsoftService?: 'outlook'|'microsoft-calendar'|'onedrive'|'teams'|'sharepoint'; microsoftScopes?: string[]
  }
}

interface LocalSource extends SourceConfigBase {
  type: 'local'
  local: { path: string; format?: string }   // path: absolute hoặc ~, scope trong homedir
}

type SourceConfig = McpSource | ApiSource | LocalSource
```

**Runtime-only (KHÔNG persist):** `tools`, `resources`, `status` cũ → thay bằng `connectionStatus` persisted. UI vẫn strip runtime fields trước khi ghi.

## Storage + migration

- Folder: `~/.awog/sources/<slug>/{config.json, guide.md, permissions.json, icon.*}`. Dir `0o700`, `config.json` `0o600` (giữ atomic write của `mcp/store.ts`).
- `guide.md`: parse section `## Scope|Guidelines|Context|API Notes|Cache` (mirror `parseGuideMarkdown` của Craft). `## Cache` chứa ```json block.
- **Migration** (boot, idempotent): với mỗi `~/.awog/mcp-servers/<id>.json` → tạo `sources/<slug>/config.json` với `type:'mcp'`, gói `command/args/env/cwd`→`mcp` (transport stdio) hoặc `url/headers`→`mcp` (transport http). Giữ `id`/secret refs. Đánh dấu migrated (đổi tên dir cũ `mcp-servers/` → `mcp-servers.migrated/` hoặc ghi cờ) để không chạy lại. **KHÔNG mất config/secret cũ.**
- Keychain: giữ service group `awog-mcp`, account `<id>/<key>` cho secret env/header (không đổi để không mất token đã lưu). Token OAuth: bucket riêng (xem P2).

## Vòng đời + trạng thái (bỏ autoStart/idle-config)

- **Bỏ** `autoStart`, `McpManager` idle-stop-config, vòng đời process-thường-trực-nuôi-status.
- Trang Connections hiển thị `connectionStatus` (từ `source.test`/auth gần nhất), không phải "process đang chạy".
- Kết nối runtime = lazy pool (đã có `POOL` theo `poolKey=sessionId` trong `mcp-tools.ts`, idle 15'). Mở rộng để reconnect khi config/token đổi (mirror `mcpConfigChanged` của Craft: so `url` + `Authorization` header).
- `deriveConnectionStatus(source, localMcpEnabled)`: stdio + local-mcp-off → `local_disabled`; `connectionStatus` explicit thắng; else suy từ auth (`authType none/undefined` ⇒ connected; else `isAuthenticated` ⇒ connected / `needs_auth`).

## Runtime bridge (tool)

- Tên tool giữ `mcp__<slug>__<tool>` (mọi mapper trace/step + nudge phụ thuộc). API source → 1 tool `api_<slug>` (qua pool thành `mcp__<slug>__api_<slug>`).
- API tool: dựng **Pi `AgentTool`** in-process (không `createSdkMcpServer`). Input `{ path, method, params, _intent }`, `params._rawBody`/`_contentType` cho body non-JSON; `guardLargeResult` → lưu `downloads/` khi lớn/binary.
- Hai resolver phải đồng bộ mọi kind/auth mới: [sessions.send-message.ts](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts) (~L691-777) + [tasks/agent-context.ts](../../apps/desktop/sidecar/src/tasks/agent-context.ts) (~L68-177). Union type resolved: [runtime/permission-types.ts](../../apps/desktop/sidecar/src/runtime/permission-types.ts) (~L29-41).

## source.test (per-kind)

Mirror `session-tools-core/src/handlers/source-test.ts`: (1) exists, (2) validate schema, (3) icon (download URL/cache), (4) completeness (guide/tagline warn), (5) connection test theo kind (mcp handshake / api `testEndpoint` có auth / local path), (6) auth status, (7) ghi `lastTestedAt/connectionStatus/connectionError` + auto-enable khi sạch, (8) summary. `McpTestOutcome` mở rộng per-kind.

## OAuth (P2/P6)

- MCP OAuth: `discoverOAuthMetadata` (RFC 9728 → 401 `WWW-Authenticate resource_metadata` → protected-resource metadata → auth-server metadata; fallback RFC 8414) + PKCE S256 + DCR (public client, fallback `client_id` cố định) + loopback callback 8914–8924, timeout 5'. **SSRF-guard**: HTTPS-only + chặn private IP (tái dùng `ssrfCheck`/`blockedHostReason` ở `mcp/http-client.ts`).
- Lưu token: **keychain AWOG** (bucket mới, vd service `awog-source-oauth`, account `<slug>`) — value + refreshToken + expiresAt + clientId. KHÔNG file `credentials.enc`.
- Refresh: mirror `TokenRefreshManager` (dedupe per-slug, cooldown 5' sau fail, refresh trước hết hạn 5'); inject `Authorization: Bearer` lúc connect. Renew-endpoint cho API non-OAuth (`{{token}}` substitution).
- RPC mới: `source.startOAuth` / `source.completeOAuth` / `source.cancelOAuth` (mirror `auth.*-oauth-codex`), event `source.oauth-url`.

## Permissions (P4)

`permissions.json` per-source: `allowedMcpPatterns` (auto-scope `mcp__<slug>__.*<pattern>`), `allowedApiEndpoints` (`{method, path-regex}`), `allowedBashPatterns`, `allowedWritePaths`. Merge additive (hardcoded read-only → default → workspace → mỗi active source). Nối vào permission gate runtime ([runtime/permission.ts](../../apps/desktop/sidecar/src/runtime/permission.ts) / [sessions.permission.ts](../../apps/desktop/sidecar/src/methods/sessions.permission.ts)) — **đây là chỗ bật enforce `trust`** (hiện chưa enforce).

## UI parity (P5)

Mirror Craft: **SourcesListPanel** (avatar + name + type-badge + status-badge + tagline), **SourceInfoPage** (sections Connection / Tools / Permissions / Documentation), **SourceMenu** (open-in-window / show-in-folder / send-to-workspace / delete), **source-avatar** (icon resolve + fallback theo type: mcp/api=Globe/gmail=Mail/local=HardDrive/else Plug), **status-indicator** (dot màu theo `connectionStatus`), **SourceSelectorPopover** (chọn source active cho message ở composer). Tất cả string qua i18n `connections.json` (en/vi). Giữ form `ConnectionEditor` + AI `source.author`.

## Phân rã theo phase

Mỗi phase phải: **typecheck xanh** (`pnpm typecheck` ở ui-next; sidecar `tsc`), **lint xanh** (`pnpm lint`), rebuild sidecar `dist` + smoke-run. Phase sau phụ thuộc phase trước.

### P0 — Nền (THUẦN ADDITIVE, KHÔNG đổi hành vi)
- Sidecar: Zod `SourceConfigSchema` (discriminated `mcp|api|local`, đủ base + `connectionStatus/isAuthenticated/connectionError/lastTestedAt`, **không** có `autoStart`) + `types/shared.ts` mirror.
- `sources/store.ts` (folder CRUD `~/.awog/sources/<slug>/`, mirror `agents/store.ts` layout + atomic write + secret keychainize như `mcp/store.ts`) + helper đọc `guide.md`/`permissions.json`/icon.
- `sources/migrate.ts`: **copy-based, idempotent, có backup** `~/.awog/mcp-servers/*.json` → `sources/<slug>/config.json` (`type:'mcp'`). **KHÔNG** move/xoá file cũ, **KHÔNG** động keychain. Cờ chống chạy lại. Wire vào boot (`index.ts`) trước khi mcpManager hydrate.
- RPC read-only `source.list` + `source.get` để verify store (register ở `index.ts`).
- **KHÔNG** động vào `mcp.*` / `McpManager` / UI. `autoStart` giữ nguyên (gỡ ở P1).
- **AC:** app boot chạy migration đúng 1 lần (copy + backup, không mất secret); mỗi `mcp-servers/<id>.json` sinh `sources/<slug>/config.json` khớp; `source.list` trả về tương đương `mcp.list`; unit-test migration trên fixture temp (KHÔNG chạy trên `~/.awog` thật); app chạy y như cũ; typecheck + lint xanh.

### P1 — MCP parity trên storage mới + gỡ autoStart + connectionStatus + source.test
- Chuyển trang Connections + runtime đọc/ghi `SourceConfig` (store mới) thay `McpServerConfig`. `mcp.*` RPC → `source.*` (alias tạm nếu cần), cập nhật `stores/connections.ts` + `ConnectionEditor`/`ConnectionDetail` + `useConnectionsPage`.
- **Gỡ `autoStart`** + `McpManager` idle-stop-config; status theo `source.test`/auth (`connectionStatus`); kết nối qua lazy pool (reconnect khi config/token đổi).
- `source.test` per-kind (P0-scope chỉ mcp).
- **AC:** thêm/sửa/xoá/test một mcp source (stdio + http) hoạt động; status đúng; runtime session vẫn gọi được tool; không còn autoStart trong UI.

### P2 — OAuth remote MCP + token-refresh
- Discovery + PKCE + DCR + loopback; lưu token keychain; refresh tự động; inject header lúc connect.
- **AC:** thêm một MCP source `authType:oauth` (vd Linear `https://mcp.linear.app`), bấm Connect → browser OAuth → `connected`; token refresh khi hết hạn không cần login lại.

### P3 — `api` source
- `ApiSourceConfig` + tool `api_<slug>` (Pi AgentTool) + auth bearer/header/multi-header/query/basic/oauth + testEndpoint + renewEndpoint.
- **AC:** thêm một API source (vd Exa `x-api-key`) → agent gọi `api_exa` trả kết quả; `source.test` xác thực credential.

### P4 — `local` source + permissions.json (Explore mode)
- `LocalSourceConfig` (fs scope theo `local.path`); `permissions.json` merge + enforce ở permission gate; bật `trust`.
- **AC:** local source giới hạn read-only đúng pattern; MCP/API bị chặn tool ngoài whitelist trong Explore mode.

### P5 — UI parity
- SourcesListPanel/SourceInfoPage/SourceMenu/avatar/status-dot/SourceSelectorPopover + icon/tagline + i18n; giữ form + AI creator.
- **AC:** UI khớp Craft về cấu trúc + trạng thái; add-source qua cả form lẫn AI; icon/tagline hiển thị.

### P6 — Google/Microsoft/Slack + `source_*` session tools + export/import
- OAuth provider-specific + scope presets; `source_test`/`source_oauth_trigger`/`source_credential_prompt`... callable trong session; `<sources>` context block + auto-activate-on-tool-error; `resources.export/import` bundle.
- **AC:** setup Gmail/Slack/Linear qua hội thoại trong session như Craft; export/import source bundle.

## Ngoài phạm vi (YAGNI)
- Tier project cho source (giữ global-only).
- OAuth relay đa-workspace của Craft (single-user local).
- `credentials.enc` machine-id (dùng keychain).
- `McpPoolServer` HTTP cho subprocess ngoài (chưa cần; AWOG bridge in-process).

## Rủi ro
- Migration sai → mất config/secret. Bắt buộc backup dir cũ trước khi migrate.
- Hai resolver runtime lệch nhau. Thêm test đồng bộ.
- Dev: sidecar không watch — rebuild `dist` + restart mỗi lần sửa sidecar.
