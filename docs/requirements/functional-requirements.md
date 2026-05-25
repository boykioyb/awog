# Functional Requirements

Các năng lực chức năng cấp cao mà AWOG phải có. Mỗi mục liên kết tới đặc tả chi tiết tại [../features/](../features/).

## FR-1. Quản lý Agent

Hệ thống phải cho phép người dùng tạo, cấu hình và quản lý các AI agent tùy biến.

- Định nghĩa thuộc tính agent: name, role, description, model, system prompt
- Gán skill và context provider cho agent
- Hỗ trợ nhiều model backend (Claude, OpenAI, Gemini, local model)

→ Xem [agent-builder](../features/agent-builder.md)

## FR-2. Quản lý Skill

Hệ thống phải cho phép người dùng định nghĩa các năng lực agent có thể tái sử dụng.

- Tạo skill với input, output, prompt template, tags và category
- Gán skill cho agent
- Tái sử dụng skill xuyên nhiều agent và workflow

→ Xem [skill-builder](../features/skill-builder.md)

## FR-3. Thiết kế Workflow

Hệ thống phải cung cấp một workflow editor trực quan.

- Trình soạn thảo DAG kéo-thả
- Gán agent và skill cho từng node
- Định nghĩa edge mapping output → input
- Chèn approval gate cho con người
- Versioning workflow

→ Xem [workflow-builder](../features/workflow-builder.md)

## FR-4. Thực thi Task

Hệ thống phải thực thi workflow dưới dạng task gắn với project cụ thể.

- Task bắt buộc gắn với một Project
- Nhận task từ input thủ công, GitHub Issue, Jira ticket, hoặc local request
- Theo dõi trạng thái task: `queued`, `running`, `waiting_approval`, `completed`, `failed`
- Quản lý từng Phase (instance của node trong task) với run history (v1, v2, …)
- Cho phép rerun từ một phase (invalidate phase đó và downstream, đánh dấu run cũ `superseded`)
- Lưu lịch sử thực thi

→ Xem [task-execution-engine](../features/task-execution-engine.md)

## FR-5. Hệ thống Artifact

Hệ thống phải quản lý artifact như bộ nhớ chung của các agent.

- Hỗ trợ định dạng: Markdown (`.md`), diff/patch (`.diff`, `.patch`), YAML (`.yaml`, `.yml`), Mermaid (`.mmd`)
- Render Markdown đầy đủ kèm mermaid diagram
- Diff viewer chuyên dụng cho `.diff` / `.patch`
- Lịch sử phiên bản với diff giữa các version
- Artifact explorer (tree view) và markdown editor fullscreen
- Versioning bằng Git

→ Xem [artifact-system](../features/artifact-system.md), [markdown-editor](../features/markdown-editor.md)

## FR-6. Phê duyệt của con người

Hệ thống phải hỗ trợ approval gate cho human-in-the-loop.

- Approve / Rerun-from-here / Comment trong tab Discussion
- Workflow tạm dừng tại approval node
- Sự kiện approval được ghi vào trace

→ Xem [human-approval](../features/human-approval.md)

## FR-7. Session của Agent

Mỗi agent phải có một session độc lập để tránh context pollution.

→ Xem [session-system](../features/session-system.md)

## FR-8. Context Provider

Agent phải có thể truy cập các nguồn tri thức bên ngoài.

- Provider trong MVP: Artifacts, GitNexus, Filesystem
- Connector qua Settings: Notion, Jira, Slack
- Mỗi agent có whitelist provider riêng

→ Xem [context-providers](../features/context-providers.md)

## FR-9. Agent Trace & Observability

Người dùng phải xem được chính xác cách agent hoạt động.

- 4 loại trace node: `agent`, `subagent`, `tool`, `thinking`
- Subagent có purpose riêng, model riêng, tools riêng
- Trace tree expandable/collapsible với live indicator cho node đang chạy
- 3 tab cho mỗi phase: Output, Execution, Discussion

→ Xem [agent-trace](../features/agent-trace.md)

## FR-10. Quản lý Project

Hệ thống phải cho phép người dùng đăng ký và quản lý các codebase local.

- CRUD project: tạo (link existing folder hoặc clone từ git), xem, sửa, xóa với confirmation
- Metadata: name, path, description, gitRemote, gitBranch, language, createdAt
- Task bắt buộc chọn project; project detail hiển thị danh sách task liên quan

→ Xem [projects](../features/projects.md)

## FR-11. Settings

Hệ thống phải cung cấp panel Settings 4 section:

- **Workspace** — local path, Git versioning, auto-approve, notifications
- **Models & API Keys** — Anthropic, OpenAI, Google + custom provider (OpenRouter, Ollama, LM Studio)
- **Connectors** — Notion, Jira, Slack
- **Appearance** — theme toggle

→ Xem [settings](../features/settings.md)

## FR-12. MCP Servers (Plugin Tooling)

Hệ thống phải cho phép user cài MCP server bên ngoài để mở rộng năng lực agent.

- Hỗ trợ 2 transport chính: stdio (process spawn) và http
- CRUD MCP server qua Settings → MCP Servers
- Whitelist server per-agent (giống context provider)
- Trust mode per server: allow / prompt / deny cho tool call
- Restart/health monitoring với auto-restart và backoff

→ Xem [mcp-servers](../features/mcp-servers.md)

## FR-13. Hooks (Event Automation)

Hệ thống phải cho phép user định nghĩa script chạy tự động trên event trong AWOG.

- Event taxonomy: task/phase/artifact/agent/tool/mcp/session
- Hook script nhận payload qua stdin, có thể block hành động bằng exit code
- Matcher filter event (glob path, status, …)
- Run mode: blocking (chờ) hoặc background (fire-and-forget)
- Audit log mỗi hook run

→ Xem [hooks](../features/hooks.md)

## FR-14. Slash Commands (Shortcuts)

Hệ thống phải hỗ trợ slash command để user trigger nhanh hành động trong Discussion.

- 4 type: prompt (template) / agent-switch / shell / workflow
- Picker fuzzy filter mở khi gõ `/`
- Argument typed (string, file, agent, artifact, …) với sub-picker
- Scope: global / project / agent
- Built-in command (`/help`, `/use`, `/run`, `/approve`, …)

→ Xem [slash-commands](../features/slash-commands.md)

## FR-15. Theme System

Hệ thống phải hỗ trợ dark/light theme được tune riêng (không invert):

- Dark: phong cách Linear/GitHub, deep neutrals
- Light: phong cách Notion/Vercel, warm off-white
- Mermaid diagram và scrollbar tự sync màu theo theme

→ Xem [theme-system](../features/theme-system.md)
