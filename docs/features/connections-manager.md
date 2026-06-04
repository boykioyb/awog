# Feature Spec: Connections Manager

> **Brief:** [connections-manager.brief.md](./connections-manager.brief.md)
> **ADR:** [0025-connections-manager.md](../decisions/0025-connections-manager.md)
> **Status:** Approved (kiến trúc chốt qua ADR 0025) — sẵn sàng decompose
> **Last updated:** 2026-06-03

## Tóm tắt

Cho phép người dùng quản lý **một chỗ** các "kết nối có credential" tới hệ thống ngoài (GitHub, Jira, …) và **tái sử dụng** chúng xuyên task/agent.

**Mô hình khái niệm (chốt — [ADR 0025](../decisions/0025-connections-manager.md)):** *Connections* là khái niệm bao trùm (user-facing); **một MCP server là *transport* hiện thực một connection** — MCP là *một loại* connection, **không** đồng nhất "MCP ≡ Connection". Khái niệm "MCP" vẫn còn ở tầng kỹ thuật (editor: "Transport: MCP stdio/http"); tương lai connection non-MCP (vd `gh` CLI) có thể cùng umbrella. Vì vậy trang **"MCP Servers" được reframe/đổi tên thành "Connections"** (không tạo entity hay credential-store thứ hai; tái dùng keychain [ADR 0018](../decisions/0018-mcp-secret-keychain.md) + per-agent whitelist [ADR 0016](../decisions/0016-deprecate-context-providers-fold-into-mcp.md)). Mỗi connection bổ sung thuộc tính `service` (github/jira/…). Khi tạo task gắn source GitHub/Jira, người dùng chọn connection sẽ dùng; engine tự đưa MCP server đó vào toolset của mọi node để agent truy cập được nguồn.

**Account thuộc về đâu (chốt):**

- **Account (token GitHub/Jira) thuộc về Connection** — không có entity "Account" riêng cho service ngoài. Connection gói `{service, transport, credential}`; token luôn ở **OS keychain** (`secret:KEY`). Nhiều tài khoản cùng service = nhiều connection. (Khác với **Anthropic Accounts** = auth model-provider ở `credentials.json` — layer riêng vì sidecar gọi model trực tiếp; cố tình không gộp.)
- **Connection có tier `global` + `project`** (giống Workflows): config global ở `~/.awog/mcp-servers/<id>.json`, hoặc per-project ở `{project.path}/.awog/mcp-servers/<id>.json` (đi theo repo, git-track). **Token KHÔNG bao giờ commit** — config (kể cả per-project) chỉ chứa `secret:KEY` ref; giá trị thật ở keychain local mỗi máy → team share *hình dạng* connection, mỗi người tự nhập token.

## User flow

### Flow chính (golden path)

1. **Cấu hình connection** — Settings → Connections (hoặc MCP Servers): user tạo/chỉnh một MCP server, gắn `service = github`, nhập token dạng `secret:GITHUB_TOKEN` (lưu keychain). Connection hiện trong danh sách với status (running/idle/error).
2. **Gắn vào task** — New Task → chọn source = GitHub → field **Connection** xuất hiện, list các connection `service=github` đang enabled. User chọn 1 (mặc định: connection github gần nhất; hoặc "System — `gh` CLI").
3. **Chạy** — engine thực thi: với mỗi node, MCP server của connection được **union** vào `mcpServers` (đã expand secret trong sidecar). Agent gọi `mcp__<id>__*` để đọc/ghi GitHub. Token không bao giờ rời sidecar.
4. **Tái dùng** — task/agent khác chọn lại cùng connection; đổi token một chỗ (keychain) → mọi nơi dùng giá trị mới ở lần chạy kế.

### Flow phụ

- **Chưa có connection cho service** → picker hiện empty state + CTA "Add GitHub connection" (mở MCP create preset) + tùy chọn "System (`gh` CLI)".
- **Manual source** → không có field Connection (không cần).
- **Agent-level** vẫn giữ nguyên: agent whitelist MCP qua `mcpServerIds`; connection của task là lớp **bổ sung** (union), không thay thế.

## Acceptance criteria

- **AC1.** Given một MCP server có `service='github'` và `enabled`, when user mở New Task với source=GitHub, then field Connection liệt kê server đó.
- **AC2.** Given không có connection `service=github` nào, when source=GitHub, then picker hiện empty state + CTA tạo connection GitHub + tùy chọn "System (`gh` CLI)".
- **AC3.** Given task tạo với `source.connectionId = X`, when engine chạy bất kỳ node nào, then MCP server X được đưa vào `mcpServers` của node đó **bất kể** per-agent whitelist của agent.
- **AC4.** Given connection có secret, when task chạy, then token chỉ được expand trong sidecar; **không** xuất hiện trong `task.json`, `events.log`, trace node, hay bất kỳ `task.*` event nào (invariant #1).
- **AC5.** Given user chọn "System (`gh` CLI)", then `source.connectionId` = `null`/`'system'`, không MCP server nào được inject, agent dùng `gh` hệ thống.
- **AC6.** Given màn Connections, then liệt kê mọi MCP server **gắn service** kèm status + secret hiển thị dạng `••••` (không bao giờ plaintext).
- **AC7.** Given user đổi token của connection (keychain), when task/agent chạy lần kế, then dùng token mới — không phải nhập lại ở chỗ khác.
- **AC8.** Given task đã tạo với connection X rồi user xóa connection X, when mở lại task / chạy lại, then UI cảnh báo "connection không còn" + node chạy không có MCP server đó (agent có thể fail tool call — ghi vào trace).
- **AC9.** Given nhiều connection cùng `service=github`, when chọn ở New Task, then tất cả được liệt kê (kèm tên) và chọn được đúng 1.
- **AC10.** Given connection tier `project`, when lưu, then config ở `{project}/.awog/mcp-servers/<id>.json` và **token ở OS keychain**; file chỉ chứa `secret:KEY` ref — **không bao giờ** plaintext token trong file/repo.
- **AC11.** Given task của project P, when mở Connection picker, then liệt kê connection `global` + connection của project P (mirror cách scope của Workflows/Agents).

## UI behavior

- **Component liên quan:** `components/task/NewTaskModal.vue` (thêm Connection field theo source), `components/mcp/McpEditor.vue` (thêm select `service`), `components/mcp/McpDetail.vue` + `pages/mcp-servers/index.vue` reframe thành Connections (đổi nhãn UI, gom theo `service`).
- **Route:** đổi tên `/mcp-servers` → `/connections` (giữ redirect `/mcp-servers` → `/connections` để tương thích). Không tạo page song song.
- **State mới ở store:** `mcpServers` đã có; thêm getter `connectionsByService(service)`; task store giữ `source.connectionId`.
- **Empty/loading/error:** empty = "Chưa có connection <service>" + CTA; error = MCP server status `error` hiện badge đỏ; loading = theo MCP status hiện có.
- **i18n:** thêm namespace `connections.*` (en/vi) — không hardcode.

## Data shape

- **`McpServerConfig`** ([sidecar shared.ts](../../apps/desktop/sidecar/src/types/shared.ts) + [ui types](../../apps/desktop/ui/types/index.ts)): thêm `service?: 'github' | 'jira' | 'gitnexus' | 'generic'` (optional → backward-compat; thiếu = `generic`) **và** tier `source?: 'global' | 'project'` + `projectId?` (giống Workflow — derive từ vị trí file, không lưu trong JSON). **Không** thêm field credential mới (vẫn `env`/`headers` + `secret:KEY`).
- **MCP store đa-tier (mới):** hiện MCP chỉ global (`~/.awog/mcp-servers/`). Thêm tier project `{project.path}/.awog/mcp-servers/<id>.json` — mirror `workflows/store.ts`. **Token vẫn ở OS keychain** (không vào file/repo) ở cả 2 tier.
- **`TaskSource`**: thêm `connectionId?: string` cho biến thể `github`/`jira` (= mcpServerId, hoặc `'system'` cho gh CLI). Optional.
- **File trên đĩa:** không thêm store credential mới. `service`+tier ghi vào `mcp-servers/<id>.json` (global hoặc project); `connectionId` nằm trong `task.json` (qua `source`).
- **Event log:** không thêm event mới; trace/commit giữ nguyên (không log token).

## Edge case

- Connection bị xóa sau khi task tạo → AC8 (cảnh báo + node thiếu MCP).
- Token sai/hết hạn → AWOG **không** pre-validate; lỗi xuất hiện lúc agent gọi tool → ghi vào trace node (`result: [error]`), node có thể fail. (Pre-validation/test-connection: out of scope lần đầu.)
- Secret thiếu trong keychain → MCP server fail start (cơ chế MCP hiện có) → status `error`, AC6 hiện đỏ.
- Nhiều connection cùng service → AC9 (list hết).
- App restart giữa task đang chạy → engine resume; connection resolve lại từ `source.connectionId` lúc chạy node (không cache token).
- Source = manual → không field connection.
- `gh` CLI không cài trên máy + chọn "System" → agent tool fail → trace error (giống token sai).

## Dependencies

- **Entity hiện có:** MCP Server (config + keychain + manager), Task (`source`), Agent (`mcpServerIds`).
- **Engine:** [node-runner.ts](../../apps/desktop/sidecar/src/tasks/node-runner.ts) / [agent-context.ts](../../apps/desktop/sidecar/src/tasks/agent-context.ts) — nơi build `mcpServers`; cần union connection của task.
- **ADR ảnh hưởng:** [0014](../decisions/0014-mcp-servers-stdio-runtime.md), [0016](../decisions/0016-deprecate-context-providers-fold-into-mcp.md), [0018](../decisions/0018-mcp-secret-keychain.md), [0024](../decisions/0024-task-execution-engine-ipc-contract.md). **Cần ADR mới** ratify: reframe MCP Servers → Connections, field `service`, `source.connectionId`, engine union connection (Q1/Q2 đã chốt khái niệm).
- **External:** GitHub/Jira MCP server (do user cấu hình), `gh` CLI (tùy chọn system).

## Non-functional

| Tiêu chí | Mục tiêu |
|---|---|
| Latency UI | Connection picker render < 100ms (đọc từ store đã hydrate) |
| Offline | Có — cấu hình connection offline; truy cập service thì cần mạng (lỗi → trace) |
| Restart-safe | Có — connectionId persist trong task.json; resolve lại lúc chạy |
| Bảo mật | Token chỉ trong keychain + sidecar; 0 lộ ra UI/log/event (invariant #1) |

## Out of scope

- Native GitHub/Jira API client trong AWOG (vẫn qua MCP server làm transport).
- OAuth flow tương tác cho GitHub/Jira (chỉ token/PAT qua keychain bản đầu).
- "Test connection" / pre-validate token trước khi chạy.
- Hợp nhất Anthropic model accounts vào màn Connections.
- Đa máy / chia sẻ connection.

## Open questions

- ~~**Q1**~~ **(chốt với user).** Không tạo entity mới: **MCP server = connection**; "MCP Servers" reframe thành "Connections", thêm thuộc tính `service`. → Vẫn nên **ADR** ratify việc đổi tên + field `service` + hành vi engine, nhưng quyết định khái niệm đã rõ.
- ~~**Q2**~~ **(chốt với user).** **Không** page song song: "Connections" **thay thế/đổi tên** trang MCP Servers (gộp một chỗ). Route `/mcp-servers` → `/connections` (giữ redirect tương thích).
- ~~**Q (scope)**~~ **(chốt với user).** Connection có tier **global + per-project** (giống Workflows). MCP store cần thêm tier project — công việc mới, mirror `workflows/store.ts`.
- ~~**Q (account)**~~ **(chốt với user).** Account (token) **thuộc về Connection**, không entity riêng.
- ~~**Q3**~~ **(chốt — [ADR 0025](../decisions/0025-connections-manager.md) D-7).** "System (`gh` CLI)" **defer** sang sau; bản đầu chỉ MCP-based connection.
- ~~**Q4**~~ **(chốt — [ADR 0025](../decisions/0025-connections-manager.md) D-6).** Engine union connection vào **mọi node** của task.

> Toàn bộ open question đã chốt — kiến trúc ratify tại [ADR 0025](../decisions/0025-connections-manager.md). Sẵn sàng cho PM decompose.

## Liên kết

- Brief: [connections-manager.brief.md](./connections-manager.brief.md)
- ADR: [0014](../decisions/0014-mcp-servers-stdio-runtime.md), [0016](../decisions/0016-deprecate-context-providers-fold-into-mcp.md), [0018](../decisions/0018-mcp-secret-keychain.md), [0024](../decisions/0024-task-execution-engine-ipc-contract.md)
- Spec: [mcp-servers](./mcp-servers.md), [task-execution-engine](./task-execution-engine.md)
- Architecture: [data-model](../architecture/data-model.md), [execution-model](../architecture/execution-model.md)
