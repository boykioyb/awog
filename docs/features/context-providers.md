# Feature: Context Providers

**Trạng thái:** ⛔ **Deprecated** (2026-05-29 — xem [ADR 0016](../decisions/0016-deprecate-context-providers-fold-into-mcp.md))

> Feature này bị bỏ. Mọi data source ngoài (Notion, Jira, Slack, GitHub, filesystem, v.v.) đi qua **[MCP Servers](./mcp-servers.md)**. Per-agent whitelist sẽ implement bằng `agent.mcpServerIds` ở pha 2 (xem MCP backlog B3 trong [ADR 0014](../decisions/0014-mcp-servers-stdio-runtime.md)).
>
> Nội dung dưới đây giữ làm tham chiếu lịch sử — không phản ánh thiết kế hiện tại.

---

## Overview (lịch sử)

Context provider mở các nguồn tri thức bên ngoài cho agent. Mỗi agent khai báo provider mà nó được phép truy cập — hệ thống kiểm soát tại runtime.

## Provider trong MVP

| ID | Nguồn | Hành động chính |
|---|---|---|
| `artifacts` | Artifact trong workspace | read/write |
| `gitnexus` | Knowledge graph codebase | semantic_search, read, find_callers |
| `filesystem` | File hệ thống (sandbox) | read, edit |
| `notion` | Notion (qua connector) | search, read |
| `jira` | Jira (qua connector) | fetch ticket |
| `slack` | Slack (qua connector) | search, message |

GitNexus, Notion, Jira, Slack cấu hình qua [Settings → Connectors](./settings.md).

## Provider tương lai (sau MVP)

- GitHub (issue, PR, code).
- GitLab.
- Confluence.
- Database (SQL).
- Linear.

## Giao diện Provider (khái niệm)

- `list()` — liệt kê resource.
- `read(resource)` — fetch content.
- `search(query)` — keyword / semantic.
- `write(resource, content)` — khi được hỗ trợ.

## Bảo mật

- **Whitelist per-agent** — mỗi agent chỉ truy cập được provider được cấu hình.
- **Scope đọc/ghi** — provider có thể chỉ cho phép read.
- **Filesystem sandbox** — chỉ truy cập trong path đã đăng ký qua Projects hoặc whitelist trong settings.
- **Credential** (OAuth token, API key) lưu qua OS keychain, không bao giờ in ra log.

## Phụ thuộc

- [agent-builder](./agent-builder.md) — chọn provider per agent.
- [settings](./settings.md) — connector configuration.
- [projects](./projects.md) — định nghĩa filesystem scope.

## Câu hỏi mở

- Có cache kết quả provider để giảm token cost không? Cache invalidation thế nào?
- Provider có rate limit riêng — handle backoff thế nào?
- Khi user revoke OAuth, các session đang dùng provider đó phải làm sao?
