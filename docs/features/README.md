# Features

Đặc tả theo feature cho AWOG. Mỗi feature/module có một tài liệu riêng.

## Danh mục

| # | Feature | Trạng thái |
|---|---|---|
| 1 | [projects](./projects.md) | Draft |
| 2 | [agent-builder](./agent-builder.md) | Draft |
| 3 | [skill-builder](./skill-builder.md) | Draft |
| 4 | [workflow-builder](./workflow-builder.md) | Draft |
| 5 | [artifact-system](./artifact-system.md) | Draft |
| 6 | [markdown-editor](./markdown-editor.md) | Draft |
| 7 | [task-execution-engine](./task-execution-engine.md) | Draft |
| 8 | [human-approval](./human-approval.md) | Draft |
| 9 | [session-system](./session-system.md) | Draft |
| 10 | [context-providers](./context-providers.md) | Draft |
| 11 | [agent-trace](./agent-trace.md) | Draft |
| 12 | [settings](./settings.md) | Draft |
| 13 | [theme-system](./theme-system.md) | Draft |
| 14 | [mcp-servers](./mcp-servers.md) | Draft |
| 15 | [hooks](./hooks.md) | v1 implemented (ADR 0032) |
| 16 | [slash-commands](./slash-commands.md) | Draft |
| 17 | [git-manager](./git-manager.md) | Draft |
| 18 | [auto-update](./auto-update.md) | In Review |
| 19 | rtk-token-proxy (đã gỡ — xem [ADR 0031](../decisions/0031-rtk-token-proxy.md)) | Reverted (2026-06-15) |
| 20 | [rules](./rules.md) | v1 implemented (ADR 0033) |
| 21 | [project-github](./project-github.md) | Draft (ADR 0049) — Issues + Pull Requests |
| 22 | [global-terminal](./global-terminal.md) | Implemented (ui-next) — dock terminal toàn app, cwd home |
| 23 | [office-preview](./office-preview.md) | Implemented (ui-next) — xem `.docx`/`.xlsx` trong PreviewModal, parser tự viết |
| 24 | [preview-popout-window](./preview-popout-window.md) | Implemented (ui-next + electron) — mở file ra cửa sổ OS riêng, nhiều cửa sổ cùng lúc |
| 25 | [session-popout-window](./session-popout-window.md) | Implemented (ui-next + electron) — mở session ra cửa sổ OS riêng, hand-off quyền sở hữu |
| 26 | [desktop-pet](./desktop-pet.md) | P1 implemented (ui-next + electron) — pet nổi trên mọi cửa sổ + mini-HUD, opt-in ở Settings → Appearance |
| 27 | [wiki](./wiki.md) | v1 implemented ([ADR 0073](../decisions/0073-wiki-as-llm-context-source.md)) — trang wiki trong app: đọc/soạn/import `.md`, đồng thời là nguồn context cho LLM (tool `wiki_search`/`wiki_read` trên 2 runtime) |
| 28 | [ai-memory](./ai-memory.md) | v1 implemented ([ADR 0073](../decisions/0073-wiki-as-llm-context-source.md) phần B) — fact dài hạn, agent ghi (opt-in, mặc định TẮT) + quản lý ở Settings → Bộ nhớ |

## Template

Mỗi tài liệu feature nên gồm:

1. **Overview** — feature làm gì, trong 2–3 câu.
2. **User Stories** — ai dùng và đạt được gì.
3. **Functional Behavior** — hành vi chi tiết, edge case.
4. **Data Model** — entity, field, cách bố trí file.
5. **UI/UX Notes** — pattern tương tác, màn hình chính (liên kết tới [../design/](../design/)).
6. **Dependencies** — feature hoặc module phụ thuộc.
7. **Out of Scope** — những gì feature này không bao phủ.
8. **Open Questions** — các quyết định còn để ngỏ.

## Trạng thái

- **Draft** — phác thảo ban đầu, có thể chưa đầy đủ.
- **In Review** — sẵn sàng cho stakeholder phản hồi.
- **Approved** — khóa lại để implement.
- **Implemented** — đã có trong sản phẩm.
