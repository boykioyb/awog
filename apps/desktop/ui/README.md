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

✅ **Tasks (wired)** — list + group/filter/search, task detail với pipeline timeline, 3 tab per phase (Output/Execution/Discussion), run history pills, Approve / Rerun-from-here, NewTaskModal. Chạy thật qua **Task Execution Engine** sidecar ([ADR 0024](../../../docs/decisions/0024-task-execution-engine-ipc-contract.md)): `tasks.*` RPC, stream `task.*` events (parallel phases, live trace, artifact = `run.output`), git auto-commit per phase. Store `tasks` subscribe ở app-lifetime.
✅ **Projects** — CRUD với link existing / clone from git, project detail với session list (+ nút New session điều hướng sang Sessions) và task list, 3-col meta grid.
✅ **Workflows (wired)** — DAG canvas drag-drop, agent palette, edge bezier, inspector pane. Persist 2 tier qua `workflows.*` RPC (no-cycle validate): **global** `~/.awog/workflows/<id>.json` (dùng chung) + **per-project** `{project}/.awog/workflows/<id>.json` (đi theo repo). Scope selector + tier badge trên list; store `workflows` debounce ~500ms khi kéo/nối + flush on unmount.
✅ **Agents** — CRUD list/detail/editor với 12-model picker, skills picker theo category, context providers.
✅ **Skills** — **đã pivot sang SKILL.md folder format** ([ADR 0013](../../../docs/decisions/0013-adopt-skill-md-format.md)). 5-tier discovery (global `~/.awog/skills`, `~/.claude/skills`, `~/.agents/skills` + project `.claude/skills`, `.agents/skills`). Chat-driven creation: click "+ New" → mini chat với claude-agent-sdk → LLM dùng Write tool tự tạo folder + SKILL.md. Body edit via LLM prompt. Bulk delete. Toast feedback toàn diện.
✅ **Settings** — 4 section (Workspace / Models & API Keys / Connectors / Appearance).
✅ **Markdown editor fullscreen** — file tree sidebar, code/split/preview, mermaid diagram, diff viewer, status bar.
✅ **Theme system** — dark (Linear/GitHub) + light (Notion/Vercel) với 20+ token, scrollbar sync.
✅ **Git Manager wired (M0..M7)** — route `/git` layout **Sublime-Merge style**: sidebar resizable/collapsible (Local Changes / All Commits / Branches / Remotes / Tags / Stashes / Submodules) + main pane switch theo selection, đã wire qua **24 sidecar `git.*` IPC method** (gồm `discoverRepos`; xem [ADR 0017](../../../docs/decisions/0017-git-manager-ipc-contract.md), [docs/features/git-manager.md](../../../docs/features/git-manager.md)). **Multi-repo per project** (repo picker ở header khi project là container nhiều repo), **auto-fetch** background mặc định 5 phút (silent), **branch tree** trong sidebar (folder default đóng, current branch accent) + **Changes tree/flat toggle** (default tree). Bootstrap probe `git.checkInstalled` block page nếu thiếu Git ≥ 2.20. Empty-state `git.init` cho workspace chưa init. Stage-hunk per hunk (`git apply --cached`), detached HEAD warn + `temp/<sha7>` flow, virtual-scroll khi section > 200 file, branches/remotes cache 5s, debounced 200ms status refresh từ chokidar watcher. Progress strip overlay (absolute, không shift layout) khi fetch/pull/push. Pinia store `git` giữ fallback mock cho browser dev (sidecar unavailable). I18n en/vi (`useI18n()` composable).
✅ **Tauri shell** — đã wire (M6), webview load UI Nuxt, IPC stdio qua `engine_call` (xem [ADR 0006](../../../docs/decisions/0006-tauri-shell-for-nuxt.md), [ADR 0008](../../../docs/decisions/0008-stdio-ipc-for-sidecar.md)).
✅ **Node.js sidecar wiring** — package `@awog/sidecar` chạy stdio NDJSON JSON-RPC; UI gọi qua composable `useSidecar()`.
✅ **Anthropic OAuth Pro/Max** — sign-in 3-step dialog, token refresh, account management (xem [docs/features/models-and-accounts.md](../../../docs/features/models-and-accounts.md), [ADR 0011](../../../docs/decisions/0011-anthropic-subscription-oauth.md)).
✅ **Sessions chat streaming** — SSE token stream, markdown render, reply borderless + byline footer (copy/branch · latency · token), attach file (📎 + kéo-thả) với preview ảnh inline (data URL) (xem [docs/features/sessions.md](../../../docs/features/sessions.md)).
✅ **Sessions persistence** — JSONL event-sourced tại `~/.awog/sessions/<id>.jsonl`.
✅ **Composer follow-up** — bôi đen text trong agent reply → "Quote & follow up" → chip + note editor trong composer, prepend quote block khi send (xem [docs/features/sessions.md#composer-follow-up-quote--instruct](../../../docs/features/sessions.md#composer-follow-up-quote--instruct)).
✅ **Session Info panel** — nút ⓘ ở session header mở panel right-docked (resizable, store `sessionInfoPanel`) hiển thị "context" của session: **Details** (id/created/updated/messages/model/provider/mode/thinking/connections/agents), **Project** (tên + path + "View in Finder" qua `revealPath`) và **Context files** (attachments + `@file` mentions gom từ messages — attachment mở lightbox, mention real-path có Reveal/Open qua `revealPath`/`openPath`). Loại trừ lẫn nhau với Workspace Panel (chỉ một panel dock phải mỗi lúc). Lưu ý: attachments/mentions chỉ in-memory (không persist xuống JSONL) → trống sau reload.
✅ **Header tab-bar shell** — navigation chuyển từ NavRail (sidebar trái) sang **thanh tab ngang trên header** (`HeaderTabBar.vue`): 10 mục cố định icon+label (cuộn ngang khi tràn) + cụm tiện ích phải (What's New / Settings / theme toggle). Mỗi trang section bật **keep-alive** (`<NuxtPage :keepalive>`) → đổi tab giữ nguyên state + tab đã ghé chạy nền song song. **Badge sống** trên tab: Tasks `N` (running count), Sessions chấm pulsing (đang stream), Git chấm dirty + chip `↑/↓`. Trang fullscreen (`edit/[taskId]`, `projects/[id]/code`, `__sidecar-debug`) opt-out keep-alive (`definePageMeta({ keepalive: false })`). Xem [docs/features/header-tab-shell.md](../../../docs/features/header-tab-shell.md).
✅ **Liquid Glass (toàn app)** — giao diện kính mờ macOS qua composable mode-aware `useGlass()` (panel/overlay/menu/input/pill + ambient backdrop), dẫn xuất từ `useTheme()` token. **Công tắc** Settings → Appearance ("Liquid Glass", mặc định BẬT); tắt = giao diện solid cũ. List item/tab = glass pill; sidebar/list-pane/modal/menu/popover frosted; input giữ gần đặc cho dễ đọc; list row không blur (perf). CSS-only (chưa dùng Electron vibrancy). Xem [docs/features/liquid-glass.md](../../../docs/features/liquid-glass.md).
✅ **What's New** — nút trên header tab-bar (cụm tiện ích phải) mở `WhatsNewModal` liệt kê release note (changelog tĩnh `utils/changelog.ts`, song ngữ en/vi). Dot "unseen" khi version mới nhất khác version đã xem; lưu last-seen trong localStorage (`useWhatsNew`). Local-first, không fetch remote.
⏳ **System tray + native notification** — đặc tả ở docs, chưa implement.
⏳ **Agents engine wiring** — agent CRUD đã wire (sidecar `agents.*`); engine injection cho session/task đã dùng AGENT.md runtime. (Tasks/Workflows nay đã wire — xem trên.)

## Cấu trúc

```
ui/
├── app.vue                 # Root, <NuxtLayout><NuxtPage :keepalive /></NuxtLayout>
├── layouts/
│   └── default.vue         # Shell: HeaderTabBar (top) + UpdateBanner + content slot
├── components/
│   │
│   │ # Primitive + layout (dùng chéo, giữ ở root) — auto-import dùng pathPrefix:false
│   ├── HeaderTabBar.vue
│   ├── BaseModal.vue, MasterDetailShell.vue, EditorShell.vue, PromptCreatorPanel.vue
│   ├── AppInput.vue, AppToggle.vue, SearchInput.vue, CompactSelect.vue
│   ├── Field.vue, Section.vue, EmptyView.vue, ToggleCard.vue, ToggleField.vue
│   ├── ContextMenu.vue, ConfirmDeleteModal.vue, AttachmentLightbox.vue
│   ├── KvEditor.vue, KeyRow.vue, KeyValueCard.vue
│   │
│   │ # Entity folders (PR-6 consolidation sweep)
│   ├── agent/        # AgentDetail.vue, AgentEditor.vue, AgentPromptCreator.vue
│   ├── command/      # CommandDetail.vue, CommandEditor.vue, CommandPromptCreator.vue, CommandBodyEditModal.vue
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
│   │   ├── workspace/ # SessionWorkspacePanel + tabs (Diff/Files/Plan/Terminal/Tasks/Preview)
│   │   └── info/      # SessionInfoPanel + Section + FileRow (Session Info panel)
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
│   ├── useMentionAutocomplete.ts # @file / $agent / /command-skill autocomplete state — PR-5.A (@file = live workspace files)
│   ├── useWorkspaceFileIndex.ts # @file index: fetch/cache fs.listFiles per workspaceRoot (lazy, deduped, browser-dev → empty)
│   └── useSidecar.ts       # Wrapper invoke('engine_call') + listen('sidecar.event') — M7
├── stores/
│   ├── workspace.ts        # Projects, agents, skills, mcp, hooks, commands + actions
│   ├── tasks.ts            # Live task store — hydrate + CRUD + subscribe task.* events (ADR 0024)
│   ├── workflows.ts        # Live workflow store — hydrate + CRUD + debounced DAG persist
│   └── settings.ts         # Workspace path, API keys, connectors
├── pages/
│   ├── index.vue           # Redirect → /tasks
│   ├── tasks/index.vue
│   ├── projects/index.vue
│   ├── workflows/index.vue
│   ├── agents/index.vue      # Agents (wired M8 + Pha 2A — AGENT.md 5-tier, runtime systemPrompt/tools/skillIds/mcpServerIds injection, bulk delete, toast, source picker)
│   ├── skills/index.vue
│   ├── connections/index.vue # Connections (ADR 0025 — rename of MCP Servers, flat list; stdio + http + secret keychain + idle stop)
│   ├── mcp-servers/index.vue # Redirect → /connections (back-compat)
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

- State: `projects`, `agents`, `skills`, `mcpServers`, `hooks`, `commands`
- Getters: `projectById`, `agentById`, `skillById`
- Actions: CRUD cho projects/agents/skills/mcp + hydrate sidecar

`useTasksStore()` — live tasks: `hydrateFromSidecar`, `subscribe()` (app-lifetime `task.*` router), `createTask`/`deleteTask`/`renameTask`, `approvePhase`/`rerunFromPhase`/`sendMessageToPhase` (RPC + browser-dev sim). Getters `selectedTask`/`taskById`/`runningPhaseIds`.

`useWorkflowsStore()` — live workflows: `hydrateFromSidecar`, CRUD + `updateWorkflowNodes/Edges` (debounced persist) + `flushPendingPersist`.

`useSettingsStore()` — workspace path, API keys, connectors.

## Routes

- `/` → redirect `/tasks`
- `/tasks` → tasks list + detail
- `/projects` → projects CRUD
- `/projects/:id/code` → **Project Code Workspace** (fullscreen IDE, no layout): Monaco multi-tab editor + explorer (new/rename/delete) + find-in-files + bottom terminal + Source Control panel. Mở qua nút "Open in Editor" ở project detail, hoặc deep-link `?file=<path>` (cầu nối từ session Files tab — `MonacoEditor` dùng chung). Xem [docs/features/project-workspace.md](../../../docs/features/project-workspace.md), [ADR 0021](../../../docs/decisions/0021-monaco-code-editor.md)/[0022](../../../docs/decisions/0022-fs-read-write-search-ipc.md)
- `/workflows` → DAG designer
- `/agents` → agents CRUD
- `/skills` → skills CRUD
- `/git` → Git Manager (sidebar nav: Local Changes / All Commits / Branches / Remotes / Tags / Stashes / Submodules) — live IPC
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

- ✅ Wire engine thật cho Tasks / Workflows ([ADR 0024](../../../docs/decisions/0024-task-execution-engine-ipc-contract.md)) — Agents/Skills đã wire
- Pause-on-quota (`waiting_connection`, [ADR 0010](../../../docs/decisions/0010-pause-on-quota-for-connection-switch.md)) — deferred, additive trên engine
- System tray + native notification ([design/tray-and-notifications.md](../../../docs/design/tray-and-notifications.md))
- ✅ API key auth mode + OpenAI/Google + custom OpenAI-compatible endpoint (Ollama/vLLM/LM Studio/OpenRouter) qua Pi runtime ([ADR 0029](../../../docs/decisions/0029-migrate-llm-runtime-to-pi-sdk.md) Phase C3). Settings → Models & API Keys: card OpenAI/Google connect bằng key (`SettingsApiKeyProviderCard.vue`), custom endpoint có chọn API type (Anthropic-/OpenAI-compatible). Non-anthropic luôn đi qua Pi runtime bất kể cờ `AWOG_RUNTIME`.
- ✅ **OpenAI subscription (ChatGPT Plus/Pro) qua Codex OAuth** ([ADR 0029](../../../docs/decisions/0029-migrate-llm-runtime-to-pi-sdk.md)). Nút "Sign in with ChatGPT" trên card OpenAI → browser (loopback) OAuth flow (`SettingsCodexSignInDialog.vue`): sidecar phát event `auth.oauth-url`, UI tự mở URL authorize của OpenAI trên trình duyệt, pi bắt redirect qua callback server localhost (127.0.0.1:1455) rồi resolve — KHÔNG cần bật "device code authentication" trong ChatGPT settings (đó là lý do bỏ device-code flow cũ). Token do Pi quản (`piOAuth` blob lưu verbatim trong `credentials.json`, strip khỏi `toSafe`); model resolve qua provider `openai-codex` — chỉ surface model dùng được với ChatGPT subscription (gpt-5.5 / gpt-5.4 / gpt-5.4-mini); model API-key-only như `gpt-5.3-codex-spark` bị lọc khỏi `account.models` trong `toSafe` (xem `codexSubscriptionModelIds`) để picker không chào model OpenAI từ chối. Test/Disconnect/SetActive dùng chung handler với API-key account.
- OS keychain migration cho credentials
