# Plan: Connections Manager

> **Spec:** [connections-manager.md](./connections-manager.md) · **ADR:** [0025](../decisions/0025-connections-manager.md) · **Brief:** [connections-manager.brief.md](./connections-manager.brief.md)
> **Target milestone:** v-next
> **Last updated:** 2026-06-03

## DAG (high level)

```
T1(ADR ✅) → T2(types) → T3(store đa-tier) → T4(mcp.* methods)
                 │             │                   │
                 │             ├──────────────► T7(Connections page) ─┐
                 │             │                   T5(route) ─────────┤
                 │             │                   T6(editor service) ┤
                 │             │                   T8(i18n) ──────────┤
                 ├────► T10(connectionId persist)                     │
                 │                                                     ▼
                 └────► T11(engine union) ◄── T9(NewTaskModal picker) ── T13(QA AC1..11)
                                  │                                    T12(infosec)
                                  └───────────────► T14(docs sync)
```

Critical path: **T2 → T3 → T4 → T9 → T11 → T13**.

## MVP / v-next scope

### Phase 1 — Schema + multi-tier store

#### T1. ADR 0025 — Connections kiến trúc ✅
- **Size:** S · **Role:** tech-lead · **Depends on:** none
- **Acceptance:** [0025-connections-manager.md](../decisions/0025-connections-manager.md) (Proposed → Accepted khi merge). **DONE.**

#### T2. Types: `service` + tier + `connectionId`
- **Size:** S · **Role:** developer · **Depends on:** T1
- **Acceptance:**
  - `McpServerConfig` (sidecar [shared.ts](../../apps/desktop/sidecar/src/types/shared.ts) + UI [types/index.ts](../../apps/desktop/ui/types/index.ts)) thêm `service?: 'github'|'jira'|'gitnexus'|'generic'` + `source?: 'global'|'project'` + `projectId?` (optional, backward-compat).
  - `TaskSource` (github/jira) thêm `connectionId?: string`.
  - `pnpm typecheck` (UI) + sidecar `tsc` pass.

#### T3. Sidecar `mcp/store.ts` đa-tier (global + project)
- **Size:** M · **Role:** developer · **Depends on:** T2
- **Acceptance:**
  - Mirror `workflows/store.ts`: `listServers(projectIds)` quét global `~/.awog/mcp-servers/` + project `{project.path}/.awog/mcp-servers/`; `source`/`projectId` derive từ vị trí (không lưu trong JSON).
  - `loadServer/saveServer/deleteServer` theo tier; `service` persist trong JSON.
  - **Token vẫn ở OS keychain** ở cả 2 tier; file (kể cả project) chỉ chứa `secret:KEY` ref (AC10).
  - Unit: save project-tier → file ở đúng `{project}/.awog/...`, không có plaintext token.

#### T4. `mcp.*` methods nhận projectIds + service/tier
- **Size:** S–M · **Role:** developer · **Depends on:** T3
- **Acceptance:**
  - `mcp.list` nhận `{ projectIds? }`, trả server kèm `service`/tier (mirror `workflows.list`).
  - `mcp.upsert` zod chấp nhận `service` + tier; ghi đúng tier.
  - UI store `workspace` (mcp) hydrate truyền projectIds.

### Phase 2 — Reframe UI: MCP Servers → Connections

#### T5. Route rename `/mcp-servers` → `/connections` + redirect + nav
- **Size:** S · **Role:** developer · **Depends on:** T4
- **Acceptance:** page mới `/connections`; `/mcp-servers` redirect; NavRail label "Connections". Giữ "MCP" làm nhãn transport (không xóa khái niệm).

#### T6. McpEditor: thêm `service` select + nhãn "Transport: MCP"
- **Size:** S · **Role:** developer · **Depends on:** T2
- **Acceptance:** editor có dropdown `service`; hiển thị "Transport: MCP stdio/http"; lưu qua `mcp.upsert`.

#### T7. Connections page: gom theo `service` + tier badge + status + secret ••••
- **Size:** M · **Role:** developer · **Depends on:** T4, T5
- **Acceptance (AC6):** liệt kê mọi connection gom theo service; badge tier (Global/tên project); status (running/idle/error); secret hiển thị `••••` (không plaintext).

#### T8. i18n `connections.*` (en/vi)
- **Size:** S · **Role:** developer · **Depends on:** T5, T6, T7
- **Acceptance:** không hardcode chuỗi mới; en/vi parity; `pnpm lint` pass.

### Phase 3 — Task source picker + engine union

#### T9. NewTaskModal: Connection picker theo source
- **Size:** M · **Role:** developer · **Depends on:** T4
- **Acceptance:**
  - Source github/jira → field Connection list connection **global + của project đang chọn**, lọc theo `service` khớp (AC1, AC9, AC11).
  - Chưa có connection → empty state + CTA "Add <service> connection" (mở create) (AC2).
  - Connection đã chọn bị xóa → cảnh báo (AC8).
  - Source manual → không field.

#### T10. Persist `source.connectionId` khi tạo task
- **Size:** S · **Role:** developer · **Depends on:** T2, T9
- **Acceptance:** `tasks.create` nhận + lưu `source.connectionId` vào `task.json`; round-trip qua `tasks.get`.

#### T11. Engine union connection vào mọi node
- **Size:** M · **Role:** developer · **Depends on:** T3, T10
- **Acceptance (AC3, AC4):**
  - [agent-context.ts](../../apps/desktop/sidecar/src/tasks/agent-context.ts)/[node-runner.ts](../../apps/desktop/sidecar/src/tasks/node-runner.ts): `mcpServers` của node = (enabled ∩ agent whitelist) ∪ {connection của task}; secret expand trong sidecar.
  - Token connection **không** xuất hiện trong `task.json`/`events.log`/trace node/`task.*` event.

### Cross-cutting

#### T12. infosec review — credential isolation
- **Size:** S · **Role:** infosec · **Depends on:** T3, T11
- **Acceptance:** xác nhận invariant #1 (AC4, AC10): grep + đọc — token chỉ ở keychain/sidecar; project-tier file không chứa plaintext; không log token. Report findings.

#### T13. QA — test cases AC1..AC11
- **Size:** M · **Role:** qa-tester · **Depends on:** T9, T11
- **Acceptance:** test case (manual + tự động khi được) phủ AC1–AC11 + edge (xóa connection, token sai → trace error, nhiều connection cùng service, restart giữa task).

#### T14. Docs sync
- **Size:** S · **Role:** docs/developer · **Depends on:** T7, T11
- **Acceptance:** cập nhật [CLAUDE.md], [ui/README.md], [mcp-servers.md](./mcp-servers.md) (đổi tên + tier + service); ADR 0025 → Accepted.

## Backlog (sau)

#### T15. "System (`gh` CLI)" connection (defer — ADR 0025 D-7)
- **Size:** S–M · **Role:** developer · **Depends on:** T9
- **Acceptance (AC5):** `connectionId: 'system'` → không inject MCP, agent dùng `gh` hệ thống. Cân nhắc trust với infosec trước.

## Test plan high-level

- TC theo **AC1–AC11** của spec (T13).
- Edge ưu tiên cao: (1) project-tier config **không** chứa token (bảo mật); (2) connection bị xóa sau khi task tạo; (3) token sai/hết hạn → lỗi hiện ở trace, không crash task.

## Risks

- **MCP store đa-tier** đụng code MCP đang chạy thật → regression risk; T3 cần test kỹ + giữ default `global`.
- **Reframe UI** chạm nhiều file + i18n → tách T5/T6/T7/T8 để review từng phần.
- **Engine union** có thể mở rộng toolset ngoài ý muốn → giới hạn đúng connection của task, không kéo thêm.

## Open questions

- Hết — kiến trúc chốt ở [ADR 0025](../decisions/0025-connections-manager.md). T15 (gh CLI) defer.
