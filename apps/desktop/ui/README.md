# AWOG UI

Nuxt 4 frontend cho AWOG desktop app. Sẽ chạy bên trong Tauri shell (xem [ADR 0006](../../../docs/decisions/0006-tauri-shell-for-nuxt.md)), hiện tại chạy thuần web để phát triển UI.

## Stack

- **Nuxt 4** (SPA mode, `ssr: false`)
- **Vue 3 + TypeScript**
- **TailwindCSS 3** (utility cho layout, inline `:style` cho theme color)
- **Pinia** (state)
- **lucide-vue-next** (icons)

## Chạy local

```bash
cd apps/desktop/ui
pnpm install
pnpm dev
```

Mặc định mở tại `http://localhost:3030` → tự redirect về `/tasks`.

## Scripts

| Lệnh                | Tác dụng                                         |
| ------------------- | ------------------------------------------------ |
| `pnpm dev`          | Dev server với HMR (http://localhost:3030)       |
| `pnpm build`        | Build production                                 |
| `pnpm typecheck`    | `vue-tsc` strict typecheck                       |
| `pnpm lint`         | ESLint check (Airbnb + Vue + TS + Prettier)      |
| `pnpm lint:fix`     | ESLint + Prettier tự động sửa                    |
| `pnpm format`       | Prettier format toàn bộ `.ts/.vue/.js/.json/.md` |
| `pnpm format:check` | Prettier check không sửa                         |

Chi tiết rule, override khác Airbnb: xem [docs/coding/nuxt-frontend.md#lint--format](../../../docs/coding/nuxt-frontend.md#lint--format).

## Trạng thái port (từ React prototype)

✅ **Tasks** — list + group/filter/search, task detail với pipeline timeline, 3 tab per phase (Output/Execution/Discussion), run history pills, Approve / Rerun-from-here, NewTaskModal.
✅ **Projects** — CRUD với link existing / clone from git, project detail với task list, 3-col meta grid.
✅ **Workflows** — DAG canvas drag-drop, agent palette, edge bezier, inspector pane.
✅ **Agents** — CRUD list/detail/editor với 12-model picker, skills picker theo category, context providers.
✅ **Skills** — CRUD với category filter, prompt template, tags Enter-to-add, "Used by" agents.
✅ **Settings** — 4 section (Workspace / Models & API Keys / Connectors / Appearance).
✅ **Markdown editor fullscreen** — file tree sidebar, code/split/preview, mermaid diagram, diff viewer, status bar.
✅ **Theme system** — dark (Linear/GitHub) + light (Notion/Vercel) với 20+ token, scrollbar sync.
✅ **Git Manager prototype** — route `/git` với 5 tab (Changes / History / Branches / Stash / Remotes), Pinia store mock 100% (chưa wire sidecar).
✅ **System tray + native notification** — đặc tả ở docs, chưa implement (cần Tauri shell).

## Cấu trúc

```
ui/
├── app.vue                 # Root, <NuxtLayout><NuxtPage /></NuxtLayout>
├── layouts/
│   └── default.vue         # Shell: NavRail + TopBar + content slot
├── components/
│   ├── NavRail.vue         # 5 view + Settings + theme toggle + collapse
│   ├── TopBar.vue          # Breadcrumb context-aware (project + branch + path khi đang /tasks)
│   ├── EmptyView.vue       # Placeholder
│   ├── RoleBadge.vue
│   ├── ConfirmDeleteModal.vue
│   ├── AppToggle.vue
│   ├── CompactSelect.vue
│   ├── TaskListItem.vue, TaskSourceBadge.vue, TaskDetail.vue
│   ├── PhaseCard.vue, PhaseOutputTab.vue, PhaseTraceTab.vue, PhaseDiscussTab.vue
│   ├── TraceNodeItem.vue   # recursive
│   ├── RerunModal.vue, NewTaskModal.vue
│   ├── ProjectEditor.vue, ProjectMeta.vue
│   ├── AgentDetail.vue, AgentEditor.vue
│   ├── SkillDetail.vue, SkillEditor.vue
│   ├── WorkflowNodeInspector.vue
│   ├── SettingsField.vue
│   ├── MarkdownRenderer.vue, MermaidBlock.vue, DiffViewer.vue
├── composables/
│   └── useTheme.ts         # State theme dark/light + CSS vars cho scrollbar
├── stores/
│   ├── workspace.ts        # Tasks, projects, agents, skills, workflows + actions
│   └── settings.ts         # Workspace path, API keys, connectors
├── pages/
│   ├── index.vue           # Redirect → /tasks
│   ├── tasks/index.vue
│   ├── projects/index.vue
│   ├── workflows/index.vue
│   ├── agents/index.vue
│   ├── skills/index.vue
│   ├── settings/index.vue
│   └── edit/[taskId].vue   # Fullscreen markdown editor (layout: false)
├── utils/
│   ├── themes.ts           # THEMES dark + light, 20+ token
│   ├── models.ts           # 12 model definition
│   ├── initial-data.ts     # CONTEXT_PROVIDERS, INITIAL_PROJECTS/AGENTS/SKILLS/WORKFLOWS/TASKS
│   ├── mock-output.ts      # mockOutput, mockPatch, mockArtifactContent, makeTrace, makeLiveTrace
│   ├── graph.ts            # topoSort, calcBadgeColWidth
│   ├── status-meta.ts      # STATUS_META
│   └── load-mermaid.ts     # Mermaid singleton loader
├── types/
│   └── index.ts            # Entity types
├── assets/css/main.css
├── nuxt.config.ts
├── tailwind.config.ts
└── package.json
```

## Theme

`useTheme()` composable cung cấp:

- `themeName` — `'dark' | 'light'`
- `t` — computed `ThemeTokens` (20+ field)
- `toggle()` — switch dark ↔ light

Template bind inline style:

```vue
<div :style="{ background: t.bg, color: t.text, border: `1px solid ${t.border}` }">
```

## Store

`useWorkspaceStore()` Pinia store:

- State: `projects`, `agents`, `skills`, `workflows`, `tasks`, `selectedTaskId`
- Getters: `selectedTask`, `projectById`, `workflowById`, `agentById`, `skillById`, `taskById`
- Actions: `selectTask`, `createTask`, `sendMessageToPhase`, `rerunFromPhase`, `approvePhase`, CRUD cho projects/agents/skills/workflows

`useSettingsStore()` — workspace path, API keys, connectors.

## Routes

- `/` → redirect `/tasks`
- `/tasks` → tasks list + detail
- `/projects` → projects CRUD
- `/workflows` → DAG designer
- `/agents` → agents CRUD
- `/skills` → skills CRUD
- `/git` → Git Manager (Changes / History / Branches / Stash / Remotes) — prototype mock
- `/settings` → 4-section settings
- `/edit/:taskId?file=<filename>` → fullscreen markdown editor (no layout)

Click "Open in editor" trong PhaseOutputTab sẽ navigate sang `/edit/:taskId?file=...`.

## Roadmap (sau khi port done)

- Tauri shell integration (xem [ADR 0006](../../../docs/decisions/0006-tauri-shell-for-nuxt.md))
- Node.js sidecar IPC (xem [ADR 0008](../../../docs/decisions/0008-stdio-ipc-for-sidecar.md))
- Wire engine thật thay vì mock data
- System tray + native notification ([design/tray-and-notifications.md](../../../docs/design/tray-and-notifications.md))
