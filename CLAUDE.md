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
6. [docs/decisions/](docs/decisions/) — ADR (đọc khi cần hiểu _vì sao_)
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

| Agent              | Vai trò                                     | Skill                 |
| ------------------ | ------------------------------------------- | --------------------- |
| `product-owner`    | Định hướng, đánh giá feature idea vs VISION | `write-feature-brief` |
| `business-analyst` | Spec chi tiết, AC, edge case                | `elicit-requirements` |
| `project-manager`  | Chia task, ước lượng, dependency            | `decompose-tasks`     |
| `tech-lead`        | Quyết định kiến trúc, ADR                   | `write-adr`           |
| `developer`        | Implement task, lint/typecheck              | `implement-feature`   |
| `qa-tester`        | Test case, verify AC, edge case             | `write-test-cases`    |
| `code-reviewer`    | Review chất lượng/architecture/perf         | `review-pr`           |
| `infosec`          | Audit security, 21 rule + 8 invariant AWOG  | `security-audit`      |

Pipeline điển hình: **PO → BA → PM → TL → developer → QA → reviewer (+ infosec khi đụng surface)**.

- **Đặt tên file:** `kebab-case.md`, `kebab-case.vue`, `PascalCase.vue` cho component. ADR đánh số `NNNN-title.md`.
- **Liên kết chéo:** dùng relative path trong tài liệu.
- **Một file = một chủ đề.** Đừng nhồi nhiều khái niệm vào một tài liệu.

## Stack hiện tại

Chi tiết từng lớp (bẫy đã đo, lý do thiết kế): [docs/architecture/implementation-notes.md](docs/architecture/implementation-notes.md).

- **Desktop shell** — Electron ([ADR 0027](docs/decisions/0027-tauri-vs-electron-revisit.md)), main ở `apps/desktop/electron/`. Engine là child process (`ELECTRON_RUN_AS_NODE=1`) nói **stdio JSON-RPC**; renderer chỉ thấy `window.awog` qua `contextBridge` (contextIsolation + sandbox, không nodeIntegration). Auto-update `electron-updater` ([ADR 0028](docs/decisions/0028-auto-update.md)): Win + Linux AppImage tự cài, mac + `.deb` chỉ báo.
- **Frontend** — Nuxt 4 SPA (`ssr: false`) + Vue 3 + TS ở `apps/desktop/ui-next/`. State = Pinia, mỗi store một domain. Canvas Workflow = VueFlow. Editor = Monaco ([ADR 0021](docs/decisions/0021-monaco-code-editor.md)). Icon = lucide-vue-next.
- **Styling** — Tailwind 3 + CSS token / `useTheme()`. Theme family `awog` (mặc định) hoặc `cute` qua `body[data-theme-family]` ([ADR 0072](docs/decisions/0072-cute-theme-family.md)).
- **Engine (sidecar)** — Node.js `@awog/sidecar` ở `apps/desktop/sidecar/`, RPC method ở `src/methods/`. Gồm sessions, tasks/workflows ([ADR 0024](docs/decisions/0024-task-execution-engine-ipc-contract.md)), skills/agents, MCP/Sources, `fs.*` ([ADR 0022](docs/decisions/0022-fs-read-write-search-ipc.md), ghi/xoá gate bởi `assertInsideWorkspace`), `terminal.*` PTY ([ADR 0019](docs/decisions/0019-pty-terminal-in-sidecar.md)), Git Manager (`git.*`, system git ≥ 2.20, [ADR 0017](docs/decisions/0017-git-manager-ipc-contract.md)).
- **LLM runtime — chọn theo provider, KHÔNG phải một runtime:**
  - `anthropic` → Claude Agent SDK/CLI, 100% kể cả `/compact` và one-shot ([ADR 0058](docs/decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md), [ADR 0099](docs/decisions/0099-anthropic-claude-native-runtime.md)). Một tiến trình CLI sống lâu mỗi phiên (`runtime/claude-sdk/live-process.ts`).
  - `openai` (account không có `baseURL`) → daemon `codex app-server` ([ADR 0087](docs/decisions/0087-codex-app-server-as-openai-runtime.md)).
  - Còn lại (`google`, account có `baseURL`) → Pi SDK ([ADR 0029](docs/decisions/0029-migrate-llm-runtime-to-pi-sdk.md)).
  - Lõi prompt: [ADR 0071](docs/decisions/0071-senior-engineer-prompt-core.md) + [ADR 0077](docs/decisions/0077-output-surface-no-hard-wrap.md), block ở `runtime/prompts.ts`. Mức suy luận: [ADR 0078](docs/decisions/0078-reasoning-effort-parity.md) + ultracode [ADR 0089](docs/decisions/0089-ultracode-effort-tier.md). Subagent `Task`: [ADR 0030](docs/decisions/0030-subagent-task-tool.md).
- **Storage** — filesystem JSON/YAML/MD + JSONL + Git + OS keychain, không database. **skills / agents / commands** dùng chung `.claude` với Claude Code CLI ([ADR 0070](docs/decisions/0070-share-claude-home-for-config.md)); hooks, rules và mọi data AWOG-only ở `~/.awog` + `{project}/.awog`. Secret chỉ trong keychain ([ADR 0018](docs/decisions/0018-mcp-secret-keychain.md)), không bao giờ vào file/git.

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

```bash
# CLI (terminal client, chạy độc lập)
cd apps/cli && pnpm build && node dist/cli.js --help
```

> Repo dùng **pnpm workspaces** ([pnpm-workspace.yaml](pnpm-workspace.yaml)). Khi thêm dependency, chạy trong đúng package.

## File / thư mục quan trọng

**UI (`apps/desktop/ui-next/`)**

- `app.vue` (root) · `layouts/default.vue` (shell: NavRail + TopBar) · `types/index.ts` (entity type dùng chung)
- `stores/` — Pinia theo domain; `stores/settings.ts` giữ API key, workspace path, connector
- `composables/useTheme.ts` (token dark/light) · `useThemeFamily.ts` (chỉ dùng khi theme Cute đổi MARKUP) · `assets/css/theme-cute.css`
- `pages/*.vue` dài → state ở `composables/useXxxManager.ts` (vd `useWikiManager`, `useMonitorManager`, `useLogtimeManager`)
- `components/skill/`, `components/agent/`, `components/connection/` (Sources, đổi tên từ MCP — [ADR 0025](docs/decisions/0025-connections-manager.md))
- `components/workbench/` — Session Workbench `/workbench` kiểu VS Code ([ADR 0098](docs/decisions/0098-session-workbench-ide-layout.md)); quy ước UI riêng ở `.claude/rules/workbench-ui.md`; nợ cutover `/sessions` ở `docs/features/workbench-embed-notes.md` §8

**Sidecar (`apps/desktop/sidecar/src/`)**

- `methods/` — RPC method · `watcher.ts` + `fs/watch-tree.ts` — watcher phát `*.fs-changed`
- `runtime/` — `prompts.ts` (block system-prompt), `claude-sdk/`, `codex/`, `run-stream.ts` (Pi), `chat-toolset.ts`, `tools/mcp-tools.ts`, `complete.ts` (one-shot)
- `context/` — prompt context builder (`<environment>`, `<current_state>`, CLAUDE.md/AGENTS.md)
- `skills/`, `agents/` — 2 tier trên `.claude` · `mcp/` — McpManager + SSRF guard · `credentials/keychain.ts`
- `wiki/` ([ADR 0073](docs/decisions/0073-wiki-as-llm-context-source.md)) · `memory/` (bộ nhớ AI) · `monitor/` ([ADR 0090](docs/decisions/0090-activity-monitor-process-attribution.md)) · `logtime/` ([ADR 0091](docs/decisions/0091-logtime-worklog-via-mcp.md))

**Khác**

- `apps/desktop/electron/src/` — main process, IPC, trình duyệt nhúng, remote gateway
- `apps/cli/` — terminal client `awog` ([spec](docs/features/cli.md), [ADR 0093](docs/decisions/0093-awog-cli-attach.md))
- [docs/reference/claude-sdk-options.md](docs/reference/claude-sdk-options.md) — 66 `Options` của Claude Agent SDK và AWOG dùng cái nào; đối chiếu lại mỗi lần bump SDK

## Quy tắc làm việc

- **Không thêm dependency mới** khi chưa có ADR/đồng thuận, đặc biệt với UI lib lớn (đã chọn Tailwind + lucide thay vì thư viện component).
- **Không tạo backend service mới** — engine sẽ là Node.js sidecar duy nhất.
- **Không thêm database** trong MVP. Filesystem + JSON/YAML là data layer.
- **Đừng port toàn bộ React prototype 1-1.** Tận dụng Composition API và Pinia store thay vì replicate `useState` ngang hàng.
- **Không lưu API key vào git.** API key thuộc về `settings` store, chỉ ghi xuống workspace cấu hình local của người dùng.
- **Mỗi feature lớn → một tài liệu ở [docs/features/](docs/features/).** Mỗi quyết định kiến trúc lớn → một ADR ở [docs/decisions/](docs/decisions/).

## Tính năng đã có (tra spec trước khi sửa)

Mọi tính năng dưới đây đã wire thật. Chi tiết và lịch sử đính chính: [docs/architecture/implementation-notes.md](docs/architecture/implementation-notes.md#trạng-thái-port--chi-tiết), spec ở [docs/features/](docs/features/).

- **Sessions** — transcript, checklist ([ADR 0069](docs/decisions/0069-editable-session-checklist.md)), bookmark/tìm/chặn thao tác cắt ([ADR 0074](docs/decisions/0074-session-message-anchor-and-transcript-navigation.md)–[0076](docs/decisions/0076-compact-is-not-a-bookmark-prune-path.md)), Workspace Panel ([spec](docs/features/workspace-panel.md)), popout ([spec](docs/features/session-popout-window.md)), link Session ↔ Task ([ADR 0055](docs/decisions/0055-session-task-link.md)), nhập phiên Claude Desktop/CLI ([ADR 0102](docs/decisions/0102-import-claude-desktop-cli-sessions.md))
- **Tasks + Workflows** — engine thật, JSONL event-sourced, restart-safe ([ADR 0024](docs/decisions/0024-task-execution-engine-ipc-contract.md))
- **Skills / Agents / Commands / Hooks / Rules / Sources(MCP)** — xem ADR 0013, 0014, 0015, 0018, 0025, 0070
- **Git Manager** ([spec](docs/features/git-manager.md)) · **Wiki** ([spec](docs/features/wiki.md)) · **Bộ nhớ AI** ([spec](docs/features/ai-memory.md)) · **Giám sát tài nguyên** ([spec](docs/features/activity-monitor.md)) · **Logtime** ([spec](docs/features/logtime.md)) · **Theme Cute** ([spec](docs/features/theme-cute.md))
- **Trình duyệt nhúng của agent** — `WebContentsView` trong panel ([ADR 0086](docs/decisions/0086-embedded-browser-panel.md)), nhập profile ([spec](docs/features/browser-profile-import.md)), mở link ([spec](docs/features/link-open-choice.md)), thẻ xem trước + loopback dev server ([ADR 0100](docs/decisions/0100-browser-preview-card-and-devserver-loopback.md)), hồ sơ + bookmark ([ADR 0101](docs/decisions/0101-browser-profiles-and-bookmarks.md)), proxy ([ADR 0103](docs/decisions/0103-browser-profile-proxy.md), [0105](docs/decisions/0105-free-proxy-catalog.md)), userscript ([ADR 0104](docs/decisions/0104-browser-userscripts.md)), network capture ([ADR 0106](docs/decisions/0106-browser-network-capture.md))
- **Mobile Remote Control** ([ADR 0067](docs/decisions/0067-mobile-remote-control-transport.md), [spec](docs/features/mobile-remote-control.md)) · **GitHub notifications** ([spec](docs/features/github-notifications.md)) · **Auto-update** ([spec](docs/features/auto-update.md))

## Bẫy hay gặp

- **Tính năng chạm LLM phải wire đủ các runtime.** Tool AWOG (wiki, memory, logtime…) đi cả Pi AgentTool lẫn SDK MCP server in-process. Nhánh Claude SDK **không có `TodoWrite`** (dùng `TaskCreate`/`TaskUpdate`…) và **không chèn** `<project_context_files>`/`<available_skills>` vì CLI tự nạp. Trên Codex, tiền tố `mcp__` bị cấm và `thread/resume` không nhận `dynamicTools`.
- **Sửa sidecar phải rebuild `dist` + restart engine**; UI thì hot-reload.
- **Trình duyệt nhúng vẽ đè lên mọi DOM.** Thêm overlay/modal mới thì phải khai selector vào `OVERLAYS` trong `composables/useEmbeddedBrowser.ts`, nếu không trang web đè lên overlay.
- **Overlay phủ lên thanh trên** phải có `-webkit-app-region: no-drag`, nếu không click bị vùng kéo cửa sổ nuốt.
- **KeepAlive 2 lớp** (`<NuxtPage keepalive>` + quanh `SessionDetail`): đổi trang/phiên chỉ deactivate, `onUnmounted` không bắn. Effect cấp singleton phải gate theo `isActive` / dùng `onDeactivated`.
- **Watcher trên macOS/Windows là `fs.watch` recursive**, KHÔNG đưa chokidar lại (mỗi file một fd ⇒ engine cạn fd và bị giết).
- **`components/ui/switch/Switch.vue`** nhận `checked` / `update:checked` (`v-model:checked`), KHÔNG phải `v-model` trơn — reka-ui 2.x đã bỏ prop `checked`, wrapper tự dịch sang `modelValue`.
- **Còn nợ infosec re-audit:** đăng nhập của user rơi vào partition trình duyệt agent đọc được; ngoại lệ loopback dev server (invariant #7); mọi lần mở rộng allowlist của remote gateway.

## Khi user yêu cầu feature mới

1. Kiểm tra [docs/requirements/mvp-scope.md](docs/requirements/mvp-scope.md) — có trong MVP không?
2. Kiểm tra [docs/features/](docs/features/) — đã có spec chưa?
3. Nếu chưa, đề xuất tạo spec ngắn trước khi code.
4. Code theo [docs/coding/general.md](docs/coding/general.md) + [docs/coding/nuxt-frontend.md](docs/coding/nuxt-frontend.md), cập nhật store/types khi cần.
5. Cập nhật [docs/architecture/system-overview.md](docs/architecture/system-overview.md) nếu thêm route/component mới đáng kể.
