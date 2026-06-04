# Workspace Layout

Workspace là một thư mục thuần trên đĩa. Mọi thứ AWOG biết về thiết lập của người dùng đều nằm ở đây.

```
workspace/
├── projects/                   # Codebase local đã đăng ký
│   └── <project-id>.json       # name, path, gitRemote, gitBranch, language, ...
│
├── agents/                     # Định nghĩa agent
│   ├── business-analyst.json
│   ├── solution-architect.json
│   └── senior-developer.json
│
├── skills/                     # AWOG-native skill folders (SKILL.md format)
│   ├── code-review/
│   │   ├── SKILL.md            # YAML frontmatter + markdown body
│   │   └── icon.svg            # (optional) UI icon
│   └── implement-feature/
│       └── SKILL.md
│
├── workflows/                  # Định nghĩa workflow (DAG + version)
│   ├── backend-feature-pipeline.json
│   └── quick-bug-fix.json
│
├── mcp-servers/                # Cấu hình MCP server (plugin tooling)
│   ├── gitnexus.json
│   ├── filesystem.json
│   └── notion-cloud.json
│
├── hooks/                      # Hook tự động trên event
│   ├── prettier-ts.json
│   ├── slack-notify.json
│   └── .runs/                  # Audit log rolling (không commit Git)
│       └── prettier-ts.jsonl
│
├── commands/                   # Slash command custom
│   ├── review.json
│   ├── run-tests.json
│   └── .disabled.json          # List id system command bị disable
│
├── .awog/                      # Resource user tạo, không phải config AWOG
│   └── hooks/                  # Script hook tự viết (Node/Python/shell)
│       └── check-gitignore.mjs
│
├── tasks/                      # Các instance task
│   └── <task-id>/
│       ├── task.json           # status, projectId, workflowId, phases summary
│       ├── events.log          # trace event JSONL
│       └── artifacts/          # artifact sinh ra trong task (md, diff, yaml, mmd)
│
├── artifacts/                  # Bộ nhớ chung (shared) ngoài phạm vi task
│   ├── ...
│
├── sessions/                   # State session per-agent
│   ├── ba.json
│   └── ...
│
├── settings.json               # Local settings (theme, API key encrypted, connectors)
│
└── .git/                       # Lịch sử Git tự quản lý
```

## Ghi chú

- **Mọi thứ đều được Git track** (trừ `settings.json` nếu chứa API key — nằm trong `.gitignore`).
- **Project entry chỉ trỏ tới codebase, không sao chép** — `path` trỏ đến vị trí thực của repo trên đĩa người dùng.
- **Task artifacts nested trong task** thay vì gom chung, để mỗi task có folder riêng dễ archive.
- **Run version** không tạo file riêng — lưu trong `task.json` dưới `phases[nodeId].runs[]`. Output content có thể inline (text ngắn) hoặc link tới file trong `tasks/<id>/artifacts/`.
- **Name là slug.** Tên agent / workflow / project ánh xạ trực tiếp ra tên file (kebab-case hoặc snake_case theo entity).
- **Skills dùng folder per skill** chứa `SKILL.md` (Claude Code SDK / craft-agents-oss format) thay vì 1 file JSON. Xem [skill-builder feature](../features/skill-builder.md) và [ADR 0013](../decisions/0013-adopt-skill-md-format.md).

## Skills — multi-tier discovery

AWOG scan skills từ 5 path khác nhau (3 user-level, 2 project-level):

| Tier | Path | Quét khi |
|---|---|---|
| `global` (AWOG-native) | `~/.awog/skills/<slug>/SKILL.md` | Luôn luôn |
| `user-claude` | `~/.claude/skills/<slug>/SKILL.md` | Luôn luôn (share với Claude Code SDK) |
| `user-agents` | `~/.agents/skills/<slug>/SKILL.md` | Luôn luôn (share với Craft Agents) |
| `project-claude` | `{project.path}/.claude/skills/<slug>/SKILL.md` | Per registered project |
| `project-agents` | `{project.path}/.agents/skills/<slug>/SKILL.md` | Per registered project |

Sidecar `skills.list({ projectIds })` merge cả 5 tier, trả kèm `reports[]` (path thực sự scan + count) để UI diagnose path mismatch.

## Portability

Vì mọi thứ là file thuần, người dùng có thể:

- Zip thư mục workspace để backup.
- Commit lên Git remote để chia sẻ với đồng đội (loại trừ `settings.json`).
- Diff và review thay đổi ngoài AWOG.
