# CLAUDE.md — Hướng dẫn cho Claude Code

Tài liệu này dành riêng cho Claude Code khi làm việc trên repo **AWOG**. Đọc trước khi sửa code.

## Tóm tắt dự án

AWOG (**Artifact Workflow Orchestrate Guild**) là một AI Team Operating System **local-first**, đóng gói thành desktop app qua Tauri, với Nuxt 4 làm UI + engine (Node.js sidecar). Xem [README.md](README.md) và [artifacts/VISION.md](artifacts/VISION.md) để nắm tầm nhìn.

## Bản đồ tài liệu (đọc theo thứ tự khi onboard)

1. [artifacts/VISION.md](artifacts/VISION.md) — tầm nhìn sản phẩm
2. [docs/requirements/product-overview.md](docs/requirements/product-overview.md) + [docs/requirements/mvp-scope.md](docs/requirements/mvp-scope.md) — phạm vi MVP
3. [docs/architecture/system-overview.md](docs/architecture/system-overview.md) — kiến trúc tổng quan + sơ đồ
4. [docs/architecture/data-model.md](docs/architecture/data-model.md), [docs/architecture/execution-model.md](docs/architecture/execution-model.md)
5. [docs/architecture/tech-stack.md](docs/architecture/tech-stack.md) — stack chi tiết
6. [docs/decisions/](docs/decisions/) — ADR (đọc khi cần hiểu *vì sao*)
7. [apps/desktop/ui/README.md](apps/desktop/ui/README.md) — chi tiết Nuxt UI hiện tại

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
| Desktop shell | Tauri 2 (Rust) | Đã wire [ADR 0006](docs/decisions/0006-tauri-shell-for-nuxt.md) — stdio IPC, system tray planned |
| Frontend | Nuxt 4 (SPA, `ssr: false`) + Vue 3 + TS | Đã port core features. **Agents/Skills/MCP/Projects/Git/Sessions wired**. Tasks/Workflows vẫn mock. |
| State | Pinia | Store: `workspace` (mostly live — projects/agents/skills/mcpServers hydrate sidecar; tasks/workflows mock), `settings` (live), `sessions` (live), `git` (live + browser fallback) |
| Canvas | VueFlow | Workflow DAG editor (mock) |
| Styling | TailwindCSS 3 + inline `:style` theme token | Xem `useTheme()` composable |
| Icons | lucide-vue-next | |
| Code editor | Monaco | Cho prompt + artifact (markdown editor full-screen) |
| Engine (Sidecar) | Node.js `@awog/sidecar` | Wired M7+M8+Pha2A: OAuth, Sessions, Skills, MCP (stdio+http+keychain+per-agent whitelist+idle stop), Agents (5-tier AGENT.md+runtime systemPrompt/tools/skillIds/mcpServerIds injection), Git Manager (23 method), filesystem watcher (chokidar). Use `@anthropic-ai/claude-agent-sdk` [ADR 0008](docs/decisions/0008-stdio-ipc-for-sidecar.md) |
| LLM client | `@anthropic-ai/claude-agent-sdk` (sidecar chỉ) | OAuth token via env, tool-use + permission prompts, thinking budgets |
| Storage | Filesystem JSON/YAML/MD + Git + JSONL + OS keychain | credentials.json (chmod 600) + sessions JSONL + projects.json + mcp-servers/<id>.json (env/header `secret:KEY` ref → OS keychain via `@napi-rs/keyring`, [ADR 0018](docs/decisions/0018-mcp-secret-keychain.md)) + agents/<id>.md (5-tier, Claude Code subagent format) |
| Git Manager | Wired M0..M7 ([ADR 0017](docs/decisions/0017-git-manager-ipc-contract.md), [spec](docs/features/git-manager.md)) | 23 method `git.*` per-command (bao gồm `stageHunk`, `init`), mutex per workspace, system git ≥ 2.20 với bootstrap probe + banner, chokidar watcher với debounce 200ms, virtual scroll > 200 file/section, detached HEAD warn, NO_REPO empty state + init CTA. Store `git` còn fallback mock cho browser dev. |

## Lệnh hay dùng

```bash
# UI dev
cd apps/desktop/ui
pnpm install
pnpm dev            # http://localhost:3030
pnpm typecheck      # vue-tsc strict
pnpm lint           # ESLint (Airbnb + Vue + TS + Prettier)
pnpm lint:fix       # auto-fix lint + format
pnpm format         # Prettier toàn bộ
pnpm build
```

> Repo dùng **pnpm workspaces** ([pnpm-workspace.yaml](apps/desktop/ui/pnpm-workspace.yaml)). Khi thêm dependency, chạy trong đúng package.

## File / thư mục quan trọng

| Path | Vai trò |
|---|---|
| [apps/desktop/ui/app.vue](apps/desktop/ui/app.vue) | Root component |
| [apps/desktop/ui/layouts/default.vue](apps/desktop/ui/layouts/default.vue) | Shell: NavRail + TopBar |
| [apps/desktop/ui/stores/workspace.ts](apps/desktop/ui/stores/workspace.ts) | Pinia store chính (tasks/projects/agents/skills/workflows) |
| [apps/desktop/ui/stores/settings.ts](apps/desktop/ui/stores/settings.ts) | API keys, workspace path, connectors |
| [apps/desktop/ui/composables/useTheme.ts](apps/desktop/ui/composables/useTheme.ts) | Theme tokens (dark/light) |
| [apps/desktop/ui/utils/themes.ts](apps/desktop/ui/utils/themes.ts) | 20+ theme token |
| [apps/desktop/ui/utils/initial-data.ts](apps/desktop/ui/utils/initial-data.ts) | Mock data cho store |
| [apps/desktop/ui/types/index.ts](apps/desktop/ui/types/index.ts) | Entity types (Task, Project, Agent, Skill, Workflow) |
| [apps/desktop/sidecar/src/skills/](apps/desktop/sidecar/src/skills/) | Skill storage: 5-tier scan + atomic SKILL.md write + `loadSkillByIdAnyTier` |
| [apps/desktop/sidecar/src/agents/](apps/desktop/sidecar/src/agents/) | Agent storage: 5-tier AGENT.md (both single-file + folder/AGENT.md layout) |
| [apps/desktop/sidecar/src/mcp/](apps/desktop/sidecar/src/mcp/) | McpManager (stdio+http+idle stop), HttpMcpClient + SSRF guard, secrets helper, store |
| [apps/desktop/sidecar/src/credentials/keychain.ts](apps/desktop/sidecar/src/credentials/keychain.ts) | OS keychain wrapper qua `@napi-rs/keyring` (dynamic import + graceful fallback) |
| [apps/desktop/sidecar/src/watcher.ts](apps/desktop/sidecar/src/watcher.ts) | Filesystem watcher chokidar — emit `*.fs-changed` events |
| [apps/desktop/sidecar/src/methods/](apps/desktop/sidecar/src/methods/) | 50+ RPC methods: skills.*, agents.*, mcp.*, sessions.*, projects.*, git.*, auth.*, accounts.* |
| [apps/desktop/ui/components/skill/](apps/desktop/ui/components/skill/) | SkillDetail, SkillEditor, SkillPromptCreator (mini chat), SkillBodyEditModal |
| [apps/desktop/ui/components/agent/](apps/desktop/ui/components/agent/) | AgentDetail, AgentEditor (MCP picker, source picker, body edit), AgentPromptCreator, AgentBodyEditModal |
| [apps/desktop/ui/components/mcp/](apps/desktop/ui/components/mcp/) | McpDetail, McpEditor (KvEditor secret-mode), McpPromptCreator |
| [apps/desktop/ui/components/markdown/MarkdownBodyView.vue](apps/desktop/ui/components/markdown/MarkdownBodyView.vue) | Shared section: preview/raw toggle + copy + edit, used by Skills/Agents detail |
| [agentflow-prototype.tsx](agentflow-prototype.tsx) | React prototype gốc — dùng tham chiếu khi port |

## Quy tắc làm việc

- **Không thêm dependency mới** khi chưa có ADR/đồng thuận, đặc biệt với UI lib lớn (đã chọn Tailwind + lucide thay vì thư viện component).
- **Không tạo backend service mới** — engine sẽ là Node.js sidecar duy nhất.
- **Không thêm database** trong MVP. Filesystem + JSON/YAML là data layer.
- **Đừng port toàn bộ React prototype 1-1.** Tận dụng Composition API và Pinia store thay vì replicate `useState` ngang hàng.
- **Không lưu API key vào git.** API key thuộc về `settings` store, chỉ ghi xuống workspace cấu hình local của người dùng.
- **Mỗi feature lớn → một tài liệu ở [docs/features/](docs/features/).** Mỗi quyết định kiến trúc lớn → một ADR ở [docs/decisions/](docs/decisions/).

## Trạng thái port (tham chiếu nhanh)

Theo [apps/desktop/ui/README.md](apps/desktop/ui/README.md): Tasks, Projects, Workflows, Agents, Settings, Markdown editor, Theme system — đã port. **Skills** SKILL.md folder format ([ADR 0013](docs/decisions/0013-adopt-skill-md-format.md)) với 5-tier discovery + chat-driven creation. **Agents** AGENT.md 5-tier ([ADR 0015](docs/decisions/0015-agents-persisted-runtime-systemprompt.md)) với runtime injection systemPrompt + tools + skillIds + mcpServerIds (Pha 2A). **MCP Servers** stdio + http transport ([ADR 0014](docs/decisions/0014-mcp-servers-stdio-runtime.md)) + secret keychain ([ADR 0018](docs/decisions/0018-mcp-secret-keychain.md)) + per-agent whitelist + idle stop. **Context Providers** deprecated, fold vào MCP ([ADR 0016](docs/decisions/0016-deprecate-context-providers-fold-into-mcp.md)). **Filesystem watcher** trong sidecar (chokidar) auto-refresh UI khi file `.md`/`.json` thay đổi ngoài app. **Git Manager** M0..M7 wired ([ADR 0017](docs/decisions/0017-git-manager-ipc-contract.md)). System tray + native notification — chờ Tauri shell. Pha 2A completion: [docs/features/phase-2a.tasks.md](docs/features/phase-2a.tasks.md).

## Khi user yêu cầu feature mới

1. Kiểm tra [docs/requirements/mvp-scope.md](docs/requirements/mvp-scope.md) — có trong MVP không?
2. Kiểm tra [docs/features/](docs/features/) — đã có spec chưa?
3. Nếu chưa, đề xuất tạo spec ngắn trước khi code.
4. Code theo [docs/coding/general.md](docs/coding/general.md) + [docs/coding/nuxt-frontend.md](docs/coding/nuxt-frontend.md), cập nhật store/types khi cần.
5. Cập nhật [apps/desktop/ui/README.md](apps/desktop/ui/README.md) nếu thêm route/component mới đáng kể.
