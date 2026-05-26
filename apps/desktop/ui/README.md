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
│   │
│   │ # Primitive + layout (dùng chéo, giữ ở root) — auto-import dùng pathPrefix:false
│   ├── NavRail.vue, TopBar.vue
│   ├── BaseModal.vue, MasterDetailShell.vue, EditorShell.vue, PromptCreatorPanel.vue
│   ├── AppInput.vue, AppToggle.vue, SearchInput.vue, CompactSelect.vue
│   ├── Field.vue, Section.vue, EmptyView.vue, ToggleCard.vue, ToggleField.vue
│   ├── ContextMenu.vue, ConfirmDeleteModal.vue, AttachmentLightbox.vue
│   ├── KvEditor.vue, KeyRow.vue, KeyValueCard.vue
│   │
│   │ # Entity folders (PR-6 consolidation sweep)
│   ├── agent/        # AgentDetail.vue, AgentEditor.vue, AgentPromptCreator.vue
│   ├── command/      # CommandDetail.vue, CommandEditor.vue, CommandPromptCreator.vue
│   ├── hook/         # HookDetail.vue, HookEditor.vue, HookPromptCreator.vue
│   ├── mcp/          # McpDetail.vue, McpEditor.vue, McpPromptCreator.vue
│   ├── skill/        # SkillDetail.vue, SkillEditor.vue, SkillPromptCreator.vue
│   ├── project/      # ProjectEditor.vue, ProjectMeta.vue
│   ├── task/         # TaskDetail.vue, TaskListItem.vue, TaskSourceBadge.vue, NewTaskModal.vue
│   ├── phase/        # PhaseCard.vue + tabs, StepItem.vue, TraceNodeItem.vue, RoleBadge.vue, RerunModal.vue
│   ├── markdown/     # MarkdownRenderer.vue, MarkdownInline.vue, MermaidBlock.vue, DiffViewer.vue, SideDiffViewer.vue
│   │
│   │ # Feature folders (existing)
│   ├── session/      # SessionChat (orchestrator), Header, MessageList, Composer, ChipsPopover, Autocomplete, Drawer, StepDetail — PR-5.A
│   ├── edit/         # EditorTopBar, EditorFileTree, EditorMonacoPane, EditorViewerPane — PR-5.G
│   ├── settings/     # SettingsWorkspace/Defaults/Models/Connectors/AppearanceSection + SettingsField + CustomProviderForm — PR-5.B
│   ├── git/          # GitBranchList (orchestrator), Tree, ContextMenu, NameModal, DirtyCheckoutModal, ... — PR-5.C
│   ├── workflows/    # WorkflowPalette, Canvas, ListItem, InspectorPane, AgentNode, NodeInspector, PromptCreator — PR-5.D
├── composables/
│   ├── useTheme.ts         # State theme dark/light + CSS vars cho scrollbar
│   ├── useEscape.ts        # ESC handler với module-level stack (LIFO) — primitive PR-1
│   ├── useClickOutside.ts  # Click-outside handler (mousedown) cho popover — primitive PR-1
│   ├── useMockGenerator.ts # Generic mock generator (T) — PR-4
│   ├── usePromptCreator.ts # Shared prompt → entity flow state — PR-4
│   ├── useBreakpoint.ts    # Responsive breakpoint detector
│   └── useMentionAutocomplete.ts # @-mention autocomplete state — PR-5.A
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
│   ├── load-mermaid.ts     # Mermaid singleton loader
│   ├── tokenize.ts         # Pure tokenize cho composer/autocomplete — PR-5.A
│   ├── stop-words.ts       # English stop word list (autocomplete filter)
│   ├── branch-tree.ts      # Pure: build tree từ flat branch list, validate name — PR-5.C
│   ├── workflow-edges.ts   # Pure: derive edge id — PR-5.D
│   ├── diff-parse.ts       # Pure: parse unified diff (DiffViewer / SideDiffViewer)
│   ├── file-icon.ts        # Map extension → icon (file tree)
│   ├── initial-extensions.ts, initial-sessions.ts # Mock seeds
│   └── markdown-parse.ts   # Pure: parse markdown AST (blocks + inline) — PR-5.E
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
