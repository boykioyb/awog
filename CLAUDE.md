# CLAUDE.md — Hướng dẫn cho Claude Code

Tài liệu này dành riêng cho Claude Code khi làm việc trên repo **AWOG**. Đọc trước khi sửa code.

## Tóm tắt dự án

AWOG (**Artifact Workflow Orchestrate Guild**) là một AI Team Operating System **local-first**, đóng gói thành desktop app qua **Electron**, với Nuxt 4 làm UI + engine (Node.js). Xem [README.md](README.md) và [artifacts/VISION.md](artifacts/VISION.md) để nắm tầm nhìn.

## Bản đồ tài liệu (đọc theo thứ tự khi onboard)

1. [artifacts/VISION.md](artifacts/VISION.md) — tầm nhìn sản phẩm
2. [docs/requirements/product-overview.md](docs/requirements/product-overview.md) + [docs/requirements/mvp-scope.md](docs/requirements/mvp-scope.md) — phạm vi MVP
3. [docs/architecture/system-overview.md](docs/architecture/system-overview.md) — kiến trúc tổng quan + sơ đồ
4. [docs/architecture/data-model.md](docs/architecture/data-model.md), [docs/architecture/execution-model.md](docs/architecture/execution-model.md)
5. [docs/architecture/tech-stack.md](docs/architecture/tech-stack.md) — stack chi tiết
6. [docs/decisions/](docs/decisions/) — ADR (đọc khi cần hiểu *vì sao*)
7. [apps/desktop/ui-next/](apps/desktop/ui-next/) — Nuxt UI hiện tại (SPA rebuild theo prototype)

## Quy ước quan trọng

- **Ngôn ngữ tài liệu: tiếng Việt.** Toàn bộ `docs/`, README, comment kỹ thuật → tiếng Việt. Code, identifier, log message → tiếng Anh.
- **Coding style:** đọc [docs/coding/general.md](docs/coding/general.md) (cross-stack) + [docs/coding/nuxt-frontend.md](docs/coding/nuxt-frontend.md) (UI). Đừng tự ý thay đổi convention; nếu cần thay đổi, mở thảo luận trước.

## Quick-scan rules (.claude/rules/)

Trước khi sinh code, scan file rule tương ứng:

@.claude/rules/principles.md
@.claude/rules/typescript.md
@.claude/rules/nuxt-vue.md
@.claude/rules/lint-format.md
@.claude/rules/git-commit.md
@.claude/rules/security.md

## Role-based agents (.claude/agents/)

Mỗi giai đoạn delivery có 1 agent chuyên trách + skill workflow đi kèm:

| Agent | Vai trò | Skill |
|---|---|---|
| `product-owner` | Định hướng, đánh giá feature idea vs VISION | `write-feature-brief` |
| `business-analyst` | Spec chi tiết, AC, edge case | `elicit-requirements` |
| `project-manager` | Chia task, ước lượng, dependency | `decompose-tasks` |
| `tech-lead` | Quyết định kiến trúc, ADR | `write-adr` |
| `developer` | Implement task, lint/typecheck | `implement-feature` |
| `qa-tester` | Test case, verify AC, edge case | `write-test-cases` |
| `code-reviewer` | Review chất lượng/architecture/perf | `review-pr` |
| `infosec` | Audit security, 21 rule + 8 invariant AWOG | `security-audit` |

Pipeline điển hình: **PO → BA → PM → TL → developer → QA → reviewer (+ infosec khi đụng surface)**.
- **Đặt tên file:** `kebab-case.md`, `kebab-case.vue`, `PascalCase.vue` cho component. ADR đánh số `NNNN-title.md`.
- **Liên kết chéo:** dùng relative path trong tài liệu.
- **Một file = một chủ đề.** Đừng nhồi nhiều khái niệm vào một tài liệu.

## Stack hiện tại

| Lớp | Công nghệ | Ghi chú |
|---|---|---|
| Desktop shell | **Electron** (main process = Node) | [ADR 0027](docs/decisions/0027-tauri-vs-electron-revisit.md) thay Tauri ([migration](docs/features/electron-migration.md)). `apps/desktop/electron/`: main (BrowserWindow + tray + single-instance + `app://` protocol), engine spawn qua `child_process.spawn(process.execPath, ELECTRON_RUN_AS_NODE=1)` + **stdio JSON-RPC giữ nguyên**, IPC `contextBridge` → `window.awog` (contextIsolation+sandbox, no nodeIntegration). Đóng gói electron-builder (dmg/nsis/AppImage/deb). **Auto-update** `electron-updater` ([ADR 0028](docs/decisions/0028-auto-update.md), [spec](docs/features/auto-update.md)): GitHub provider, `autoDownload=false` (hỏi trước khi tải), Win+Linux(AppImage) auto-install / mac+`.deb` notify-only; renderer (`stores/update.ts`) drive lịch check, main (`updater.ts`) reactive qua kênh `updater:event`. |
| Frontend | Nuxt 4 (SPA, `ssr: false`) + Vue 3 + TS | Đã port core features. **Agents/Skills/MCP/Projects/Git/Sessions/Tasks/Workflows wired** (Sessions có Workspace Panel: Diff/Files/Plan/Terminal/Tasks/Preview — [spec](docs/features/workspace-panel.md)). Tasks chạy thật qua engine ([ADR 0024](docs/decisions/0024-task-execution-engine-ipc-contract.md)). |
| State | Pinia | Store: `workspace` (projects/agents/skills/mcp/hooks/commands), `tasks` (live — event-driven execution, app-lifetime subscribe), `workflows` (live — DAG persist + debounce), `settings` (live), `sessions` (live), `git` (live + browser fallback). Tasks/Workflows tách store riêng; browser-dev có mock fallback. |
| Canvas | VueFlow | Workflow DAG editor (live — 2 tier: global `~/.awog/workflows/<id>.json` + per-project `{project}/.awog/workflows/<id>.json`, scope selector + tier badge) |
| Styling | TailwindCSS 3 + inline `:style` theme token | Xem `useTheme()` composable. **Theme family** ([ADR 0072](docs/decisions/0072-cute-theme-family.md), [spec](docs/features/theme-cute.md)): `awog` (mặc định) hoặc **`cute`** (mint/off-white, opt-in ở Settings → Appearance → Theme → Cute) qua `body[data-theme-family]` + `assets/css/theme-cute.css` (nạp cuối `css` array, mọi rule scoped theo attribute — thắng specificity của `<style scoped>` component mà không cần `!important`); `shadcn` còn là placeholder chưa implement. |
| Icons | lucide-vue-next | |
| Code editor | Monaco | Cho prompt + artifact (markdown editor full-screen) + **Project Code Workspace** (`MonacoEditor.vue`, model-cache multi-tab, worker bundle local, [ADR 0021](docs/decisions/0021-monaco-code-editor.md)) |
| Engine (Sidecar) | Node.js `@awog/sidecar` | Wired M7+M8+Pha2A: OAuth, Sessions, Skills, MCP/**Connections** (stdio+http+keychain+per-agent whitelist+idle stop; global-only, danh sách phẳng — trang "MCP Servers" đổi tên thành "Connections" theo [ADR 0025](docs/decisions/0025-connections-manager.md) đã đơn giản hoá, mô hình Craft "Sources"; New Task có dropdown chọn connection tùy chọn → engine union vào mọi node, KHÔNG service enum/tier), Agents (AGENT.md 2-tier trên `.claude`+runtime systemPrompt/tools/skillIds/mcpServerIds injection), Git Manager (24 method), filesystem watcher (chokidar), `fs.*` read-write + search ([ADR 0022](docs/decisions/0022-fs-read-write-search-ipc.md): listDir/readFile/listFiles/writeFile/createFile/createDir/rename/delete/search/watch/unwatch — write/delete/search gated by `assertInsideWorkspace`), `terminal.*` PTY (node-pty, [ADR 0019](docs/decisions/0019-pty-terminal-in-sidecar.md)). **Task Execution Engine** ([ADR 0024](docs/decisions/0024-task-execution-engine-ipc-contract.md)): `workflows.*` (JSON snapshot + DAG validate) + `tasks.*` (JSONL event-sourced, parallel scheduler cap 4, per-node `invokeSdk` reuse Pi core, trace stream, git auto-commit per node, approve/rerun/discuss, restart-safe resume). Use **Pi SDK** (single multi-provider runtime — [ADR 0029](docs/decisions/0029-migrate-llm-runtime-to-pi-sdk.md)). |
| LLM client | **Pi SDK** (`@earendil-works/pi-ai` + `pi-agent-core`) — single runtime | Multi-provider (Anthropic/OpenAI/Google/custom) via `runAgentLoop`; in-process AgentTools + MCP bridge; resume rebuild từ JSONL; permission hook `beforeToolCall`. OAuth + API-key credential flow. **Lõi prompt cấp senior** ([ADR 0071](docs/decisions/0071-senior-engineer-prompt-core.md)): dưới OAuth Pi chỉ prepend 1 câu identity, nên AWOG tự cấp orientation (`<environment>` + `<current_state>`) + ENGINEERING/EVIDENCE/COMMUNICATION + tool description mức chính sách; nhánh Claude SDK đã có preset `claude_code` nên chỉ bù VERIFY + EVIDENCE (hằng ⇒ nằm ở append) và `<current_state>` mỗi turn. **Subagent `Task` tool** ([ADR 0030](docs/decisions/0030-subagent-task-tool.md), [spec](docs/features/subagent-task-tool.md)): delegate sang AWOG agent (honor provider/model/account của AGENT.md, depth=1, nested step/trace qua `parentId`), bật ở Sessions + Tasks, graceful fallback (khử lỗi `Tool Task not found`). Xem [ADR 0029](docs/decisions/0029-migrate-llm-runtime-to-pi-sdk.md). |
| Storage | Filesystem JSON/YAML/MD + Git + JSONL + OS keychain | credentials.json (chmod 600) + sessions JSONL + projects.json + mcp-servers/<id>.json (Connections; global `~/.awog/mcp-servers/`; env/header `secret:KEY` ref → OS keychain via `@napi-rs/keyring`, token KHÔNG bao giờ vào file/git, [ADR 0018](docs/decisions/0018-mcp-secret-keychain.md)) + agents/<id>.md (Claude Code subagent format). **Nhà của config-entity tách theo loại ([ADR 0070](docs/decisions/0070-share-claude-home-for-config.md), supersede một phần [ADR 0035](docs/decisions/0035-consolidate-config-tiers-to-awog.md)):** **skills / agents / commands** dùng chung `.claude` với Claude Code CLI (`~/.claude/{kind}` + `{project}/.claude/{kind}`, honor `CLAUDE_CONFIG_DIR`) → sửa bên nào cũng live ngay bên kia, KHÔNG còn import; **hooks / rules** + toàn bộ data AWOG-only (sessions, credentials, projects, workflows, sources, ssh/vpn, settings, templates) ở `.awog`. Boot migration `migration/claude-home.ts` tự move + xoá thư mục cũ (bản `.claude` thắng khi trùng tên; bản lệch nội dung park vào `~/.awog/migrated-conflicts/`). |
| Git Manager | Wired M0..M7 ([ADR 0017](docs/decisions/0017-git-manager-ipc-contract.md), [spec](docs/features/git-manager.md)) | 24 method `git.*` per-command (bao gồm `stageHunk`, `init`, `discoverRepos`), mutex per workspace, system git ≥ 2.20 với bootstrap probe + banner, chokidar watcher với debounce 200ms, virtual scroll > 200 file/section, detached HEAD warn, NO_REPO empty state + init CTA. **Multi-repo per project**: `discoverRepos` quét folder project (≤2 cấp) tìm repo con → header có repo picker khi project là container nhiều repo (project root không phải repo). **Auto-fetch** background mặc định 5 phút (silent, on git page open + window focus; chỉnh/tắt ở Settings → Workspace). **Branch tree** trong sidebar (gom theo prefix `/`, folder default đóng, current branch accent); **Changes tree/flat toggle** (default tree, persisted). UI Sublime-Merge style: sidebar resizable/collapsible (Local Changes / All Commits / Branches / Remotes / Tags / Stashes / Submodules) + main pane theo selection + progress strip overlay (absolute, không shift layout). I18n en/vi. Store `git` còn fallback mock cho browser dev. |

## Lệnh hay dùng

```bash
# UI dev
cd apps/desktop/ui-next
pnpm install
pnpm dev            # http://localhost:3031
pnpm typecheck      # vue-tsc strict
pnpm lint           # ESLint 9 flat config (@nuxt/eslint + Vue + TS) + Prettier
pnpm lint:fix       # auto-fix lint + format
pnpm format         # Prettier toàn bộ
pnpm build
```

> Repo dùng **pnpm workspaces** ([pnpm-workspace.yaml](pnpm-workspace.yaml)). Khi thêm dependency, chạy trong đúng package.

## File / thư mục quan trọng

| Path | Vai trò |
|---|---|
| [apps/desktop/ui-next/app.vue](apps/desktop/ui-next/app.vue) | Root component |
| [apps/desktop/ui-next/layouts/default.vue](apps/desktop/ui-next/layouts/default.vue) | Shell: NavRail + TopBar |
| [apps/desktop/ui-next/stores/](apps/desktop/ui-next/stores/) | Pinia stores tách theo domain (agents/skills/projects/tasks/workflows/sessions/git/settings…) |
| [apps/desktop/ui-next/stores/settings.ts](apps/desktop/ui-next/stores/settings.ts) | API keys, workspace path, connectors |
| [apps/desktop/sidecar/src/wiki/](apps/desktop/sidecar/src/wiki/) | Wiki store 2-tier (`.awog/wiki`) + `<wiki_index>` inject + grep search/backlink ([ADR 0073](docs/decisions/0073-wiki-as-llm-context-source.md)) |
| [apps/desktop/ui-next/pages/wiki.vue](apps/desktop/ui-next/pages/wiki.vue) | Trang Wiki (cây · reader · outline/backlinks) — state ở `composables/useWikiManager.ts` |
| [apps/desktop/sidecar/src/memory/](apps/desktop/sidecar/src/memory/) | Bộ nhớ AI: store 1-fact-1-file 2 tier + `<memory>` inject theo ngân sách ([ADR 0073](docs/decisions/0073-wiki-as-llm-context-source.md) phần B) |
| [apps/desktop/ui-next/components/settings/SettingsMemory.vue](apps/desktop/ui-next/components/settings/SettingsMemory.vue) | Settings → Bộ nhớ: công tắc auto-write + danh sách fact (sửa/xoá/toggle/xoá hết) |
| [apps/desktop/ui-next/composables/useTheme.ts](apps/desktop/ui-next/composables/useTheme.ts) | Theme tokens (dark/light) |
| [apps/desktop/ui-next/composables/useThemeFamily.ts](apps/desktop/ui-next/composables/useThemeFamily.ts) | `{ family, isCute }` — chỉ dùng ở nơi theme "Cute" đổi MARKUP, không phải style thuần CSS ([ADR 0072](docs/decisions/0072-cute-theme-family.md)) |
| [apps/desktop/ui-next/assets/css/theme-cute.css](apps/desktop/ui-next/assets/css/theme-cute.css) | Toàn bộ theme "Cute" (mint/off-white) — mọi rule scoped `body[data-theme-family='cute']` ([spec](docs/features/theme-cute.md)) |
| [apps/desktop/ui-next/components/common/AwogMascot.vue](apps/desktop/ui-next/components/common/AwogMascot.vue) | Mascot SVG inline dùng ở theme Cute (logo/empty state) — KHÔNG phải spritesheet desktop-pet |
| [apps/desktop/ui-next/types/index.ts](apps/desktop/ui-next/types/index.ts) | Entity types (Task, Project, Agent, Skill, Workflow) |
| [apps/desktop/sidecar/src/skills/](apps/desktop/sidecar/src/skills/) | Skill storage: 2-tier scan trên `.claude` (ADR 0070) + atomic SKILL.md write + `loadSkillByIdAnyTier` |
| [apps/desktop/sidecar/src/agents/](apps/desktop/sidecar/src/agents/) | Agent storage: 2-tier AGENT.md trên `.claude` (ADR 0070; both single-file + folder/AGENT.md layout) |
| [apps/desktop/sidecar/src/mcp/](apps/desktop/sidecar/src/mcp/) | McpManager (stdio+http+idle stop), HttpMcpClient + SSRF guard, secrets helper, store |
| [apps/desktop/sidecar/src/credentials/keychain.ts](apps/desktop/sidecar/src/credentials/keychain.ts) | OS keychain wrapper qua `@napi-rs/keyring` (dynamic import + graceful fallback) |
| [apps/desktop/sidecar/src/watcher.ts](apps/desktop/sidecar/src/watcher.ts) | Filesystem watcher chokidar — emit `*.fs-changed` events (watch `.claude` cho skills/agents/commands, `.awog` cho phần còn lại) |
| [apps/desktop/sidecar/src/methods/](apps/desktop/sidecar/src/methods/) | 50+ RPC methods: skills.*, agents.*, mcp.*, sessions.*, projects.*, git.*, auth.*, accounts.* |
| [apps/desktop/sidecar/src/context/](apps/desktop/sidecar/src/context/) | Prompt context builder ([ADR 0071](docs/decisions/0071-senior-engineer-prompt-core.md)): `memory-files.ts` (CLAUDE.md/AGENTS.md + `~/.claude/CLAUDE.md`, expand `@import` đệ quy, allowlist 2 root) + `environment.ts` (`<environment>` ổn định cho system prompt / `<current_state>` tươi cho turn prompt) |
| [apps/desktop/sidecar/src/runtime/prompts.ts](apps/desktop/sidecar/src/runtime/prompts.ts) | Các block system-prompt dùng chung: VERIFY / TOOL_DISCIPLINE / TODO_USAGE / BACKGROUND_EXEC + **ENGINEERING / EVIDENCE / COMMUNICATION** ([ADR 0071](docs/decisions/0071-senior-engineer-prompt-core.md)) |
| [apps/desktop/ui-next/components/skill/](apps/desktop/ui-next/components/skill/) | SkillDetail, SkillEditor, SkillPromptCreator (mini chat), SkillBodyEditModal |
| [apps/desktop/ui-next/components/agent/](apps/desktop/ui-next/components/agent/) | AgentDetail, AgentEditor (MCP picker, source picker, body edit), AgentPromptCreator, AgentBodyEditModal |
| [apps/desktop/ui-next/components/connection/](apps/desktop/ui-next/components/connection/) | Connections/Sources UI (đổi tên từ MCP theo ADR 0025) |
| [agentflow-prototype.tsx](agentflow-prototype.tsx) | React prototype gốc — dùng tham chiếu khi port |

## Quy tắc làm việc

- **Không thêm dependency mới** khi chưa có ADR/đồng thuận, đặc biệt với UI lib lớn (đã chọn Tailwind + lucide thay vì thư viện component).
- **Không tạo backend service mới** — engine sẽ là Node.js sidecar duy nhất.
- **Không thêm database** trong MVP. Filesystem + JSON/YAML là data layer.
- **Đừng port toàn bộ React prototype 1-1.** Tận dụng Composition API và Pinia store thay vì replicate `useState` ngang hàng.
- **Không lưu API key vào git.** API key thuộc về `settings` store, chỉ ghi xuống workspace cấu hình local của người dùng.
- **Mỗi feature lớn → một tài liệu ở [docs/features/](docs/features/).** Mỗi quyết định kiến trúc lớn → một ADR ở [docs/decisions/](docs/decisions/).

## Trạng thái port (tham chiếu nhanh)

Trạng thái ui-next: Tasks, Projects, Workflows, Agents, Settings, Markdown editor, Theme system — đã port. **Skills** SKILL.md folder format ([ADR 0013](docs/decisions/0013-adopt-skill-md-format.md)) với 2-tier discovery trên `.claude` + chat-driven creation. **Agents** AGENT.md 2-tier ([ADR 0015](docs/decisions/0015-agents-persisted-runtime-systemprompt.md)) với runtime injection systemPrompt + tools + skillIds + mcpServerIds (Pha 2A). **MCP Servers** stdio + http transport ([ADR 0014](docs/decisions/0014-mcp-servers-stdio-runtime.md)) + secret keychain ([ADR 0018](docs/decisions/0018-mcp-secret-keychain.md)) + per-agent whitelist + idle stop (tool call in-process qua `runtime/tools/mcp-tools.ts` dưới Pi SDK). **Context Providers** deprecated, fold vào MCP ([ADR 0016](docs/decisions/0016-deprecate-context-providers-fold-into-mcp.md)). **Filesystem watcher** trong sidecar (chokidar) auto-refresh UI khi file `.md`/`.json` thay đổi ngoài app. **Git Manager** M0..M7 wired ([ADR 0017](docs/decisions/0017-git-manager-ipc-contract.md)). **Tasks + Workflows** wired thật ([ADR 0024](docs/decisions/0024-task-execution-engine-ipc-contract.md)): Workflow Builder persist DAG ra đĩa; Task Execution Engine chạy node qua **Pi SDK** single runtime (parallel scheduler, trace stream, git auto-commit per phase, approve/rerun/discuss, restart-safe resume từ JSONL). Store `tasks`/`workflows` riêng, subscribe `task.*` events ở app-lifetime. **Session ↔ Task link 2 chiều** ([ADR 0055](docs/decisions/0055-session-task-link.md), [spec](docs/features/session-task-link.md)): `TaskSource` thêm biến thể `session` + `Session.aboutTaskId`, chiều ngược derive client-side; spawn task từ chat (tool model `RunWorkflow` gated mutating, depth=1 — nút "Run as task" ở composer đã gỡ 2026-08-19) và "Discuss in session" từ Task (chèn `<linked_task>` context mỗi turn). **Session checklist = shared state** ([ADR 0069](docs/decisions/0069-editable-session-checklist.md), [spec](docs/features/todo-list.md)): `Session.todos` là field authoritative (persist trong `SessionHeader`), `TodoWrite` ghi qua `ToolFilter.todoSink` (chat runtime cấp sink; Tasks giữ ACK), user ghi qua `sessions.updateTodos`, list được inject lại mỗi turn dưới dạng `<session_checklist>` nên sửa của user không bị ghi đè. Banner ghim không tự ẩn (thu thành strip `done/total`), row click cycle trạng thái; step inline trong transcript vẫn read-only (log lịch sử). **Session Workspace Panel** ([spec](docs/features/workspace-panel.md)) — right-docked, 6 tab (Diff/Files/Plan/Terminal/Tasks/Preview — tab Plan có thêm section Checklist); `fs.*` read-only + `terminal.*` PTY ([ADR 0019](docs/decisions/0019-pty-terminal-in-sidecar.md)). **Session popout window** ([spec](docs/features/session-popout-window.md)): mở 1 session ra cửa sổ Electron riêng (route `/session?id=<engineId>`, `session-window.ts` keyed theo engineId) theo mô hình **hand-off** — cửa sổ chính hiện placeholder và bỏ qua event của session đó (`ownsSession` gate trong store); `engine:event` fan-out cho cửa sổ chính + popout session (KHÔNG cho tray popover); chặn pop out giữa lượt đang chạy. System tray cơ bản đã wire (Electron main); native notification dùng Notification API của renderer (Chromium). **LLM runtime** ([ADR 0029](docs/decisions/0029-migrate-llm-runtime-to-pi-sdk.md)): Pi SDK single multi-provider runtime (Anthropic/OpenAI/Google/custom) thay `@anthropic-ai/claude-agent-sdk`; Sessions + Tasks + 7 one-shot method dùng `runtime/tools/mcp-tools.ts` (in-process). Pha 2A completion: [docs/features/phase-2a.tasks.md](docs/features/phase-2a.tasks.md). **Mobile Remote Control** ([ADR 0067](docs/decisions/0067-mobile-remote-control-transport.md), [spec](docs/features/mobile-remote-control.md)): Remote Gateway ở Electron main (`remote-gateway*.ts`) bind **tailnet-only, fail-closed**, opt-in mặc định TẮT ở Settings→Devices, QR pairing port 47600; PWA riêng [apps/desktop/remote-pwa/](apps/desktop/remote-pwa/) (Vite+Vue, không Nuxt). P1 = view/send/approve; **P2 (2026-08-09)** = steer/cancel/checklist/session-create + step detail + đính kèm ảnh + search + service worker. Mọi lần **mở rộng allowlist ⇒ infosec re-audit bắt buộc**; policy tập trung ở [remote-gateway-policy.ts](apps/desktop/electron/src/remote-gateway-policy.ts) (allowlist exact-match + param-pick default-deny) và [remote-gateway-catalog.ts](apps/desktop/electron/src/remote-gateway-catalog.ts) (method local `remote.bootstrap`, result-pick). **GitHub notifications** ([spec](docs/features/github-notifications.md)): poll `gh.notifications` (account-scoped, không repo cwd) → **hộp thông báo bell ở TopBar** (`TopBarNotifications` + `useGhInbox`, badge chưa đọc, tab Tất cả/Đang theo dõi, mark-read từng thread hoặc cả hộp qua `gh.notificationsRead`) + toast bấm được + native notification khi mất focus; **opt-in theo project chỉ gate việc BÁO, không gate việc hiện** (bell luôn đầy đủ, rỗng ⇒ hộp thư thật sự sạch); kênh gửi + vị trí toast + công tắc từng nguồn gom ở **Settings→Thông báo** (`settings.notifications`: delivery toast/native/both, toastPosition, sessionEvents), dedupe theo `(id, updatedAt)`, seed im lặng chỉ 1 lần/máy (mốc = `polledAt`), floor 60s. **Wiki** ([ADR 0073](docs/decisions/0073-wiki-as-llm-context-source.md), [spec](docs/features/wiki.md)): trang tài liệu trong app (`/wiki`) **đồng thời là nguồn context cho LLM** — store 2 tier `~/.awog/wiki` + `{project}/.awog/wiki` (space = folder cấp 1, trang = `.md`, `[[wikilink]]` + backlink), import `.md` bằng dialog/kéo-thả (copy-in, allowlist đuôi + cap 1MB/trang), 9 RPC `wiki.*`, watcher `wiki.fs-changed`. Prompt mỗi turn chỉ nhận **mục lục** `<wiki_index>` (cap 4k ký tự, vượt thì giảm cấp xuống space và nói rõ); nội dung đọc theo yêu cầu qua tool `wiki_search`/`wiki_read` — wire **cả 2 runtime** (Pi = AgentTool, Claude SDK = `mcp__awogwiki__*`) vì `Read` bị `assertInsideWorkspace` chặn ở nhánh Pi. Trang `context: false` = ghi chú riêng, LLM không thấy. UI: `/wiki` (cây resize được + reader + Monaco editor + context menu) và **Settings → Wiki** (công tắc nạp + ngân sách). **Bộ nhớ AI** (phần B, [spec](docs/features/ai-memory.md)): 1 fact = 1 file `.md` 2 tier (`~/.awog/memory`, `{project}/.awog/memory`, frontmatter `name`/`description`/`type`/`enabled`, KHÔNG có `MEMORY.md` — index derive từ frontmatter), nạp `<memory>` mỗi turn nhóm theo `type`; tool `memory_remember`/`memory_forget`/`memory_read` (2 runtime), **agent tự ghi opt-in mặc định TẮT** ở Settings → Bộ nhớ, cờ đi qua IPC per-turn (`contextConfig`, KHÔNG để sidecar đọc settings.json); Tasks chỉ ĐỌC memory, không ghi. **Theme "Cute"** ([ADR 0072](docs/decisions/0072-cute-theme-family.md), [spec](docs/features/theme-cute.md)): theme family thứ 2 mint/off-white bên cạnh `awog` mặc định, opt-in ở Settings→Appearance→Theme→Cute (mặc định TẮT), toàn bộ style nằm trong `assets/css/theme-cute.css` scoped theo `body[data-theme-family='cute']` — không phá vỡ giao diện AWOG khi tắt.

## Khi user yêu cầu feature mới

1. Kiểm tra [docs/requirements/mvp-scope.md](docs/requirements/mvp-scope.md) — có trong MVP không?
2. Kiểm tra [docs/features/](docs/features/) — đã có spec chưa?
3. Nếu chưa, đề xuất tạo spec ngắn trước khi code.
4. Code theo [docs/coding/general.md](docs/coding/general.md) + [docs/coding/nuxt-frontend.md](docs/coding/nuxt-frontend.md), cập nhật store/types khi cần.
5. Cập nhật [docs/architecture/system-overview.md](docs/architecture/system-overview.md) nếu thêm route/component mới đáng kể.
