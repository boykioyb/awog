# Information Architecture

Điều hướng cấp cao và sơ đồ màn hình cho AWOG.

## Nav rail (5 view chính + Settings)

Nav rail bên trái, có thể expand/collapse:

- **Full width 192px**: logo + label.
- **Compact 48px**: icon-only với tooltip.

| View | Icon | Mục đích |
|---|---|---|
| **Tasks** | ListTodo | Quản lý và thực thi task |
| **Projects** | FolderGit2 | Quản lý codebase local |
| **Workflows** | Workflow | DAG designer |
| **Agents** | Users | Agent library |
| **Skills** | Wand2 | Skill catalog |

Bottom của rail:
- **Settings** (4 section)
- **Theme toggle** (dark / light)
- **Expand / collapse** rail

## Sơ đồ màn hình

```
/
├── /tasks                          ← danh sách task + group/filter
│   ├── /tasks/new                  ← modal tạo task (chọn project, source, workflow)
│   └── /tasks/:id                  ← task detail (header + pipeline timeline phase)
│       └── /tasks/:id/edit/:file   ← markdown editor fullscreen
├── /projects                       ← list project
│   ├── /projects/new
│   └── /projects/:id               ← project detail + task list của project
├── /workflows                      ← DAG designer
│   ├── /workflows/new
│   └── /workflows/:id              ← canvas + inspector
├── /agents                         ← list + detail + editor
│   ├── /agents/new
│   └── /agents/:id
├── /skills                         ← list + detail + editor
│   ├── /skills/new
│   └── /skills/:id
└── /settings
    ├── /settings/workspace
    ├── /settings/models
    ├── /settings/connectors
    └── /settings/appearance
```

## Thành phần global

- **Top bar** (h-11): breadcrumb context-aware (ví dụ khi xem task: tên project + branch + path), label view ở phải.
- **Nav rail trái**: 5 view + settings + theme toggle.
- **System tray** (khi đóng cửa sổ): xem [tray-and-notifications](./tray-and-notifications.md).

## Tasks view chi tiết

- **Toolbar gọn 1 hàng**: search + filter button (badge số filter active) + New.
- **4 group mode**: Project (mặc định), Status, Workflow, Flat.
- **Project filter** + **Status filter** combinable.
- **Group header sticky, collapsible, có count**.

## Task detail view

- **Header**: ID, status pill, title, project info với path, source link, workflow name, description.
- **Pipeline timeline**: danh sách phase, mỗi phase là collapsible card với 3 tab Output / Execution / Discussion.
- **Run history bar** khi phase có nhiều run.

## Markdown editor view (fullscreen)

Khi mở artifact, app chuyển sang chế độ fullscreen IDE (xem [features/markdown-editor.md](../features/markdown-editor.md)):
- File tree trái + Editor giữa + Status bar dưới.
- Back button trả về task detail.
