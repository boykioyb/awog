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
├── skills/                     # Định nghĩa skill
│   ├── gather_requirements.json
│   ├── design_architecture.json
│   └── implement_feature.json
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
- **Name là slug.** Tên agent / skill / workflow / project ánh xạ trực tiếp ra tên file (kebab-case hoặc snake_case theo entity).

## Portability

Vì mọi thứ là file thuần, người dùng có thể:

- Zip thư mục workspace để backup.
- Commit lên Git remote để chia sẻ với đồng đội (loại trừ `settings.json`).
- Diff và review thay đổi ngoài AWOG.
