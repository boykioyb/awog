# 0025 — Connections Manager: MCP Servers là Connections (service + tier global/project)

- **Trạng thái:** Amended — Simplified (chỉ giữ rename "MCP Servers" → "Connections")
- **Ngày:** 2026-06-03
- **Người quyết định:** Tech Lead (chốt cùng user/PO)

> ## ⚠️ Amendment (2026-06-03) — đơn giản hoá theo Craft "Sources"
>
> Sau khi implement, user/PO đánh giá mô hình `service` enum + tier global/project + per-task connection picker + engine union là **phức tạp thừa thãi**. Tham khảo **"Sources"** của [craft-agents-oss](https://github.com/lukilabs/craft-agents-oss) (danh sách phẳng, `provider` tự do, một tier workspace, không có per-task picker — agent/chat dùng qua whitelist + `@mention`), quyết định **rút gọn**:
>
> **GIỮ:** đổi tên trang "MCP Servers" → **"Connections"** (route `/connections`, redirect `/mcp-servers`, NavRail label). Bản chất vẫn là MCP server list phẳng (= Craft "Sources").
>
> **GIỮ — bản gọn của per-task connection (D-6):** `TaskSource.connectionId?` + một dropdown **Connection** (tùy chọn) ở NewTaskModal cho source github/jira + **engine union** connection vào MCP set của mọi node (bypass per-agent whitelist; secret expand trong sidecar). Dropdown liệt kê **mọi connection enabled** (KHÔNG lọc theo service, KHÔNG tier) + "None". Default = None → khi đó node dùng MCP của agent như cũ.
>
> **BỎ (revert phần thừa của D-5):**
> - `service` enum (`github|jira|gitnexus|generic`) — không thêm vào schema/type/picker.
> - Tier `project` + scope selector — MCP store giữ **global-only** như cũ.
>
> **Cách task dùng connection:** chọn ở dropdown (union vào mọi node), HOẶC để None và dựa vào `agent.mcpServerIds` whitelist + session MCP attach như trước.
>
> Phần "Quyết định" + "Decision summary" D-1..D-7 dưới đây giữ lại làm **bối cảnh lịch sử** của hướng ban đầu; chúng KHÔNG phản ánh code đang chạy.

## Bối cảnh

Task gắn nguồn ngoài (`source = github/jira`) hiện chỉ là **metadata** — không xác thực, không biết task sẽ truy cập hệ ngoài bằng credential nào ([task-execution-engine](../features/task-execution-engine.md), [ADR 0024](./0024-task-execution-engine-ipc-contract.md)). Người dùng hỏi "chọn account GitHub nào?" → hiện không có nơi quản lý "kết nối có credential" tái dùng.

Hạ tầng credential tái dùng **đã có**: MCP servers + OS keychain ([ADR 0018](./0018-mcp-secret-keychain.md)), per-agent whitelist + fold Context Providers vào MCP ([ADR 0016](./0016-deprecate-context-providers-fold-into-mcp.md)). Feature brief + spec ([connections-manager](../features/connections-manager.md)) đề xuất một "Connections Manager". ADR này chốt **mô hình khái niệm + storage + contract** trước khi PM decompose.

Ràng buộc: giữ 8 invariant bảo mật ([security.md](../../.claude/rules/security.md)), đặc biệt **#1 — credential không rời sidecar**; KISS/YAGNI (không tạo store thứ hai); local-first single-user.

## Quyết định

### Decision summary

| # | Vấn đề | Quyết định | Rationale |
|---|--------|------------|-----------|
| D-1 | Connection là gì | **Connections là umbrella; MCP server là *transport* hiện thực một connection** (một *loại* connection — KHÔNG đồng nhất "MCP ≡ Connection"). Đổi tên trang "MCP Servers" → "Connections"; giữ nhãn "Transport: MCP stdio/http" trong editor; route `/mcp-servers` → `/connections` (redirect). KHÔNG entity/credential-store mới. | MCP đã là lớp transport mọi tool ngoài đi qua (ADR 0016) → tái dùng, tránh store thứ hai; nhưng MCP local-tool vẫn là connection-tới-tool dưới umbrella, không bị đánh đồng với "account ngoài". |
| D-2 | Account thuộc về đâu | **Account (token GitHub/Jira) thuộc về Connection** — không entity "Account" riêng cho service ngoài. Token ở OS keychain (`secret:KEY`). | Connection gói `{service, transport, credential}`; nhiều tài khoản = nhiều connection. Khác Anthropic Accounts (auth model, `credentials.json`) — cố tình không gộp. |
| D-3 | Phạm vi connection | **Tier `global` + `project`** (mirror [Workflows](../features/workflow-builder.md)/Skills/Agents): `~/.awog/mcp-servers/<id>.json` hoặc `{project.path}/.awog/mcp-servers/<id>.json`. | Mỗi repo có thể dùng org/account khác; per-project connection đi theo repo, git-track. |
| D-4 | Token & git | **Token KHÔNG bao giờ commit.** Config (kể cả per-project) chỉ chứa `secret:KEY` ref; giá trị thật ở keychain local mỗi máy. | Invariant #1; team share *hình dạng* connection, mỗi người tự nhập token. |
| D-5 | Schema | `McpServerConfig` thêm `service?: 'github'|'jira'|'gitnexus'|'generic'` + tier `source?: 'global'|'project'` + `projectId?` (derive từ vị trí, không lưu trong JSON). `TaskSource` thêm `connectionId?` (= mcpServerId, hoặc `'system'`). | Backward-compat (optional); mirror cách Workflow tag tier. |
| D-6 | Engine dùng connection | Khi task có `source.connectionId`, engine **union** MCP server đó vào `mcpServers` của **MỌI node** (đã expand secret trong sidecar), bất kể per-agent whitelist. | Đơn giản, đảm bảo mọi agent trong task truy cập được nguồn; whitelist vẫn lọc các server khác. |
| D-7 | System `gh` CLI | **Defer.** Bản đầu không có tùy chọn "System (`gh` CLI)"; chỉ MCP-based connection. | Giảm scope; `gh` dùng auth máy ngoài tầm AWOG (trust khác). Thêm sau như `connectionId: 'system'`. |

### Chi tiết

**D-1/D-2 — Connections là umbrella, MCP là transport, account ⊂ connection.** *Connections* là khái niệm bao trùm (user-facing); một **MCP server là transport hiện thực** một connection — MCP là *một loại* connection, **không** đồng nhất. Khái niệm "MCP" vẫn còn ở tầng kỹ thuật (editor: "Transport: MCP stdio/http"); tương lai một connection non-MCP (vd `gh` CLI) có thể nằm cùng umbrella. UI "Connections" là trang MCP Servers reframe: gom theo `service`, hiện status + secret dạng `••••`. Không có entity/bảng riêng cho "GitHub account" — token là credential *trong* connection. Anthropic model accounts vẫn ở Settings → Models & API Keys (layer riêng, sidecar gọi model trực tiếp).

**D-3/D-4 — Đa-tier như Workflow.** `mcp/store.ts` thêm tier project (mirror `workflows/store.ts` ở [ADR 0024](./0024-task-execution-engine-ipc-contract.md) D-3): `listServers(projectIds)` quét global + mỗi project; `source`/`projectId` derive từ vị trí file. Keychain key vẫn theo server id (global, OS-level) — config per-project chỉ mang `secret:KEY` ref, không token.

**D-6 — Engine union.** Tại [node-runner](../../apps/desktop/sidecar/src/tasks/node-runner.ts)/[agent-context](../../apps/desktop/sidecar/src/tasks/agent-context.ts): tập `mcpServers` của node = (enabled ∩ agent whitelist) **∪** {connection của task}. Secret expand fresh per-run trong sidecar.

## Phương án đã cân nhắc

### Option A — Connections umbrella, MCP là transport (CHỌN)

- **Mô tả:** *Connections* là khái niệm bao trùm; MCP server là transport hiện thực connection (một loại connection, không đồng nhất). Đổi tên trang → Connections, giữ "MCP" làm nhãn transport; thêm `service` + tier; không entity/store mới.
- **Pros:** Tái dùng toàn bộ MCP/keychain/whitelist; không trùng lặp; KISS; nhất quán ADR 0016; tên "Connections" thân thiện + mở đường cho transport non-MCP sau (gh CLI/native).
- **Cons:** MCP local-tool (vd filesystem) nằm dưới "Connections" hơi rộng nghĩa — chấp nhận được, vì vẫn là "kết nối tới tool"; nhãn transport "MCP" giữ lại để không mất khái niệm kỹ thuật.

### Option B — Entity "Connection" mới trỏ tới MCP

- **Mô tả:** Bảng Connection `{id, service, mcpServerId, accountRef}` tách khỏi MCP.
- **Pros:** Một account dùng cho nhiều connection; mô hình chuẩn hóa hơn.
- **Cons:** Thêm 1 store + 1 layer mapping; nguy cơ lệch trạng thái với MCP; over-engineer cho single-user; trùng credential layer.

### Option C — "Accounts" mở rộng cho cả GitHub/Jira

- **Mô tả:** Gộp GitHub/Jira vào cùng concept Accounts như Anthropic.
- **Pros:** Một chỗ "accounts" duy nhất.
- **Cons:** Hai loại auth khác bản chất (model API trực tiếp vs tool qua MCP); ép chung làm phình `credentials.json` + nhập nhằng runtime. Bị bác.

## Hệ quả

### Tích cực

- Một dịch vụ = một chỗ cấu hình credential, tái dùng xuyên task/agent; đổi token một chỗ.
- New Task hiện rõ "connection nào" cho source; hết câu hỏi "account nào?".
- Per-project connection đi theo repo (git-track shape), token vẫn local.
- Không store credential thứ hai; giữ invariant #1.

### Tiêu cực / cost

- `mcp/store.ts` phải thêm tier project (công việc mới, mirror workflows) — không trivial.
- Đổi tên route + UI MCP → Connections chạm nhiều file UI + i18n.
- Engine union connection = thêm logic ở node-runner/agent-context.
- Không pre-validate token (lỗi chỉ hiện lúc agent gọi tool → trace error).

### Knock-on

- **Cập nhật:** `types/shared.ts` + `ui/types/index.ts` (`McpServerConfig.service`+tier, `TaskSource.connectionId`); `mcp/store.ts` (đa-tier); `mcp.list`/`mcp.upsert` methods (projectIds + tier); `pages/mcp-servers` + `McpDetail`/`McpEditor` reframe; `NewTaskModal` (connection picker); `node-runner`/`agent-context` (union); i18n `connections.*`.
- **Spec refresh:** [connections-manager.md](../features/connections-manager.md) (đã khớp); cập nhật [mcp-servers.md](../features/mcp-servers.md) + CLAUDE.md/README khi implement.
- **Migration:** MCP global hiện có giữ nguyên (tier mặc định `global`); không cần migrate dữ liệu (field optional).
- **Ảnh hưởng:** sidecar dev (store + engine), UI dev (reframe + picker), user (đổi nhãn "MCP Servers" → "Connections").

## Implementation pointers

- Module chạm: `sidecar/src/mcp/store.ts`, `sidecar/src/methods/mcp.*.ts`, `sidecar/src/tasks/{node-runner,agent-context}.ts`, `ui/pages/mcp-servers`, `ui/components/mcp/*`, `ui/components/task/NewTaskModal.vue`, `ui/types`, `i18n/*`.
- Test bổ sung: store đa-tier (global+project), engine union connection, **token không rò ra file/event/trace** (AC4/AC10), picker scope (AC11). Gọi `infosec` review (đụng credential + IPC).
- Rollout: incremental — (1) schema `service`+tier + store đa-tier; (2) reframe UI MCP→Connections; (3) connection picker ở NewTaskModal + engine union.

## Reversibility

- **Reversible: dễ.** Field optional (`service`/tier/`connectionId`) — bỏ đi là về MCP global cũ. Đổi tên route giữ redirect. Không xóa dữ liệu. Không 1-way door.

## Liên kết

- Spec: [connections-manager.md](../features/connections-manager.md) (+ [brief](../features/connections-manager.brief.md)), [mcp-servers.md](../features/mcp-servers.md)
- ADR: [0014](./0014-mcp-servers-stdio-runtime.md), [0016](./0016-deprecate-context-providers-fold-into-mcp.md), [0018](./0018-mcp-secret-keychain.md), [0011](./0011-anthropic-subscription-oauth.md), [0024](./0024-task-execution-engine-ipc-contract.md)
- Rules: [security.md](../../.claude/rules/security.md)
