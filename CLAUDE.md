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
| Desktop shell | Tauri (Rust) | Chưa wire, planned — [ADR 0006](docs/decisions/0006-tauri-shell-for-nuxt.md) |
| Frontend | Nuxt 4 (SPA, `ssr: false`) + Vue 3 + TS | Đang port từ React prototype |
| State | Pinia | Store: `workspace`, `settings` |
| Canvas | VueFlow | Workflow DAG editor |
| Styling | TailwindCSS 3 + inline `:style` theme token | Xem `useTheme()` composable |
| Icons | lucide-vue-next | |
| Code editor | Monaco | Cho prompt + artifact (markdown editor full-screen) |
| Engine | Node.js sidecar | Chưa implement; UI đang chạy với mock data |
| LLM | Anthropic SDK, OpenAI SDK | Phía sidecar, không expose API key cho UI |
| Storage | Filesystem JSON/YAML/MD + Git | Không database |

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
| [agentflow-prototype.tsx](agentflow-prototype.tsx) | React prototype gốc — dùng tham chiếu khi port |

## Quy tắc làm việc

- **Không thêm dependency mới** khi chưa có ADR/đồng thuận, đặc biệt với UI lib lớn (đã chọn Tailwind + lucide thay vì thư viện component).
- **Không tạo backend service mới** — engine sẽ là Node.js sidecar duy nhất.
- **Không thêm database** trong MVP. Filesystem + JSON/YAML là data layer.
- **Đừng port toàn bộ React prototype 1-1.** Tận dụng Composition API và Pinia store thay vì replicate `useState` ngang hàng.
- **Không lưu API key vào git.** API key thuộc về `settings` store, chỉ ghi xuống workspace cấu hình local của người dùng.
- **Mỗi feature lớn → một tài liệu ở [docs/features/](docs/features/).** Mỗi quyết định kiến trúc lớn → một ADR ở [docs/decisions/](docs/decisions/).

## Trạng thái port (tham chiếu nhanh)

Theo [apps/desktop/ui/README.md](apps/desktop/ui/README.md): Tasks, Projects, Workflows, Agents, Skills, Settings, Markdown editor, Theme system — đã port. System tray + native notification — chờ Tauri shell. Engine wiring — chưa.

## Khi user yêu cầu feature mới

1. Kiểm tra [docs/requirements/mvp-scope.md](docs/requirements/mvp-scope.md) — có trong MVP không?
2. Kiểm tra [docs/features/](docs/features/) — đã có spec chưa?
3. Nếu chưa, đề xuất tạo spec ngắn trước khi code.
4. Code theo [docs/coding/general.md](docs/coding/general.md) + [docs/coding/nuxt-frontend.md](docs/coding/nuxt-frontend.md), cập nhật store/types khi cần.
5. Cập nhật [apps/desktop/ui/README.md](apps/desktop/ui/README.md) nếu thêm route/component mới đáng kể.
