# AWOG UI

Nuxt 4 frontend cho AWOG desktop app. M7: đã chạy bên trong Tauri shell + nối với Node.js sidecar qua stdio NDJSON JSON-RPC (xem [ADR 0006](../../../docs/decisions/0006-tauri-shell-for-nuxt.md), [ADR 0008](../../../docs/decisions/0008-stdio-ipc-for-sidecar.md)). Vẫn chạy được thuần web để dev UI nhanh, lúc đó các RPC engine no-op.

## Stack

- **Nuxt 4** (SPA mode, `ssr: false`)
- **Vue 3 + TypeScript**
- **TailwindCSS 3** (utility cho layout, inline `:style` cho theme color)
- **Pinia** (state)
- **lucide-vue-next** (icons)
- **Tauri 2** shell — IPC qua `invoke('engine_call')` + `listen('sidecar.event')`.
- **Anthropic auth**: không dùng SDK. Sidecar gọi raw `/v1/messages` với `Authorization: Bearer <oauth_token>` + `anthropic-beta: oauth-2025-04-20` (xem [ADR 0011](../../../docs/decisions/0011-anthropic-subscription-oauth.md)).

## Chạy local

```bash
# Từ repo root — full desktop app (UI + sidecar + Tauri shell)
pnpm tauri:dev

# Từ thư mục này — chỉ UI web (engine RPC no-op)
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
✅ **Skills** — **đã pivot sang SKILL.md folder format** ([ADR 0013](../../../docs/decisions/0013-adopt-skill-md-format.md)). 5-tier discovery (global `~/.awog/skills`, `~/.claude/skills`, `~/.agents/skills` + project `.claude/skills`, `.agents/skills`). Chat-driven creation: click "+ New" → mini chat với claude-agent-sdk → LLM dùng Write tool tự tạo folder + SKILL.md. Body edit via LLM prompt. Bulk delete. Toast feedback toàn diện.
✅ **Settings** — 4 section (Workspace / Models & API Keys / Connectors / Appearance).
✅ **Markdown editor fullscreen** — file tree sidebar, code/split/preview, mermaid diagram, diff viewer, status bar.
✅ **Theme system** — dark (Linear/GitHub) + light (Notion/Vercel) với 20+ token, scrollbar sync.
✅ **Git Manager wired (M0..M7)** — route `/git` với 5 tab (Changes / History / Branches / Stash / Remotes) đã wire qua **23 sidecar `git.*` IPC method** (xem [ADR 0017](../../../docs/decisions/0017-git-manager-ipc-contract.md), [docs/features/git-manager.md](../../../docs/features/git-manager.md)). Bootstrap probe `git.checkInstalled` block page nếu thiếu Git ≥ 2.20. Empty-state `git.init` cho workspace chưa init. Stage-hunk per hunk (`git apply --cached`), detached HEAD warn + `temp/<sha7>` flow, virtual-scroll khi section > 200 file, branches/remotes cache 5s, debounced 200ms status refresh từ chokidar watcher. Pinia store `git` giữ fallback mock cho browser dev (sidecar unavailable).
✅ **Tauri shell** — đã wire (M6), webview load UI Nuxt, IPC stdio qua `engine_call` (xem [ADR 0006](../../../docs/decisions/0006-tauri-shell-for-nuxt.md), [ADR 0008](../../../docs/decisions/0008-stdio-ipc-for-sidecar.md)).
✅ **Node.js sidecar wiring** — package `@awog/sidecar` chạy stdio NDJSON JSON-RPC; UI gọi qua composable `useSidecar()`.
✅ **Anthropic OAuth Pro/Max** — sign-in 3-step dialog, token refresh, account management (xem [docs/features/models-and-accounts.md](../../../docs/features/models-and-accounts.md), [ADR 0011](../../../docs/decisions/0011-anthropic-subscription-oauth.md)).
✅ **Sessions chat streaming** — SSE token stream, markdown render, copy button, latency + token count + model id (xem [docs/features/sessions.md](../../../docs/features/sessions.md)).
✅ **Sessions persistence** — JSONL event-sourced tại `~/.awog/sessions/<id>.jsonl`.
✅ **Composer follow-up** — bôi đen text trong agent reply → "Quote & follow up" → chip + note editor trong composer, prepend quote block khi send (xem [docs/features/sessions.md#composer-follow-up-quote--instruct](../../../docs/features/sessions.md#composer-follow-up-quote--instruct)).
⏳ **System tray + native notification** — đặc tả ở docs, chưa implement.
⏳ **Tasks/Workflows/Agents engine wiring** — vẫn dùng mock data, chờ engine model schema thật. (Skills đã có engine wiring qua sidecar `skills.*` RPCs.)

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
│   ├── settings/     # SettingsWorkspace/Defaults/Models/Connectors/AppearanceSection + SettingsField + CustomProviderForm + SettingsOAuthCodeDialog — PR-5.B + M7
│   ├── git/          # GitBranchList (orchestrator), Tree, ContextMenu, NameModal, DirtyCheckoutModal, ... — PR-5.C
│   ├── workflows/    # WorkflowPalette, Canvas, ListItem, InspectorPane, AgentNode, NodeInspector, PromptCreator — PR-5.D
├── composables/
│   ├── useTheme.ts         # State theme dark/light + CSS vars cho scrollbar
│   ├── useEscape.ts        # ESC handler với module-level stack (LIFO) — primitive PR-1
│   ├── useClickOutside.ts  # Click-outside handler (mousedown) cho popover — primitive PR-1
│   ├── useMockGenerator.ts # Generic mock generator (T) — PR-4
│   ├── usePromptCreator.ts # Shared prompt → entity flow state — PR-4
│   ├── useBreakpoint.ts    # Responsive breakpoint detector
│   ├── useMentionAutocomplete.ts # @-mention autocomplete state — PR-5.A
│   └── useSidecar.ts       # Wrapper invoke('engine_call') + listen('sidecar.event') — M7
├── stores/
│   ├── workspace.ts        # Tasks, projects, agents, skills, workflows + actions
│   └── settings.ts         # Workspace path, API keys, connectors
├── pages/
│   ├── index.vue           # Redirect → /tasks
│   ├── tasks/index.vue
│   ├── projects/index.vue
│   ├── workflows/index.vue
│   ├── agents/index.vue      # Agents (wired M8 + Pha 2A — AGENT.md 5-tier, runtime systemPrompt/tools/skillIds/mcpServerIds injection, bulk delete, toast, source picker)
│   ├── skills/index.vue
│   ├── mcp-servers/index.vue # MCP servers (wired M8 + Pha 2A — stdio + http + secret keychain + idle stop)
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
│   ├── markdown-parse.ts   # Pure: parse markdown AST (blocks + inline) — PR-5.E
│   └── markdown.ts         # Render markdown bằng `marked` cho session message — M7
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

## Roadmap

Đã xong (M6 → M7):

- ✅ Tauri shell integration ([ADR 0006](../../../docs/decisions/0006-tauri-shell-for-nuxt.md))
- ✅ Node.js sidecar IPC stdio NDJSON ([ADR 0008](../../../docs/decisions/0008-stdio-ipc-for-sidecar.md))
- ✅ Anthropic OAuth Pro/Max ([ADR 0011](../../../docs/decisions/0011-anthropic-subscription-oauth.md))
- ✅ Sessions chat streaming + persistence JSONL ([docs/features/sessions.md](../../../docs/features/sessions.md))

Còn lại:

- Wire engine thật cho Tasks / Workflows / Agents / Skills (thay mock data)
- System tray + native notification ([design/tray-and-notifications.md](../../../docs/design/tray-and-notifications.md))
- API key auth mode + OpenAI/Google provider ([models-and-accounts.md TODO](../../../docs/features/models-and-accounts.md#todo-post-m7))
- OS keychain migration cho credentials
