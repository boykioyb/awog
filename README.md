# AWOG — Artifact Workflow Orchestrate Guild

> **Build AI Teams, Not AI Chats.**

AWOG là một AI Team Operating System theo hướng **local-first**. Thay vì trò chuyện với một AI agent duy nhất, người dùng thiết kế các "guild" gồm nhiều agent cộng tác với nhau qua **artifact**, **workflow**, **skill** và **context provider**.

- Tầm nhìn sản phẩm: [artifacts/VISION.md](artifacts/VISION.md)
- Tài liệu tổng: [docs/README.md](docs/README.md)
- Hướng dẫn code: [docs/coding/](docs/coding/)
- Hướng dẫn cho Claude Code: [CLAUDE.md](CLAUDE.md)

## Triết lý cốt lõi

- **Artifact là nguồn sự thật.** Agent cộng tác qua artifact, không qua lịch sử chat.
- **Workflow** định nghĩa luồng công việc giữa các agent.
- **Skill** định nghĩa năng lực; **Context provider** cung cấp tri thức động.
- **Con người giữ quyền kiểm soát** thông qua các approval checkpoint.

## Kiến trúc

| Layer | Công nghệ |
|---|---|
| Desktop shell | Tauri 2 (Rust) — system tray, notification, lifecycle, IPC bridge |
| Frontend | Nuxt 4 + Vue 3 + TypeScript + Pinia + VueFlow + TailwindCSS + Monaco |
| Engine | Node.js sidecar (package `@awog/sidecar`, stdio NDJSON JSON-RPC 2.0) |
| LLM client | Raw `fetch` `/v1/messages` với Bearer OAuth + `anthropic-beta` (không dùng SDK) |
| Storage | Local filesystem (JSON / YAML / Markdown) + Git, credentials `~/.awog/credentials.json` chmod 600 |

Chi tiết: [docs/architecture/system-overview.md](docs/architecture/system-overview.md), [docs/architecture/tech-stack.md](docs/architecture/tech-stack.md).

## Cấu trúc repo

Repo là **pnpm monorepo** (root `package.json` + [pnpm-workspace.yaml](pnpm-workspace.yaml)). 3 package thực thi đặt dưới `apps/desktop/`:

```
awog/
├── apps/
│   └── desktop/
│       ├── ui/              # Package `awog-ui` — Nuxt 4 frontend (xem apps/desktop/ui/README.md)
│       ├── sidecar/         # Package `@awog/sidecar` — Node.js engine, stdio NDJSON JSON-RPC
│       └── src-tauri/       # Crate Rust — Tauri 2 shell + IPC bridge
├── artifacts/
│   └── VISION.md            # Tầm nhìn sản phẩm
├── docs/
│   ├── requirements/        # Yêu cầu (functional, non-functional, MVP scope)
│   ├── design/              # UX flow, wireframe, visual reference
│   ├── architecture/        # System overview, data model, execution model, tech stack
│   ├── decisions/           # ADR — kiến trúc, công nghệ, scope
│   ├── features/            # Đặc tả theo feature
│   └── coding/              # Quy ước code (general + nuxt-frontend, sẽ thêm node/tauri)
├── package.json             # Root workspace scripts (tauri:dev, dev, build, lint)
├── pnpm-workspace.yaml      # Khai báo `apps/desktop/ui` + `apps/desktop/sidecar`
├── CLAUDE.md                # Hướng dẫn cho Claude Code khi làm việc trên repo này
├── MEMORY.md                # Index memory cho ngữ cảnh dự án (Claude Code)
└── README.md
```

## Yêu cầu

- **Node.js** ≥ 20 + **pnpm** ≥ 9.
- **Rustup** (toolchain stable) — cần cho Tauri shell. Cài tối thiểu: <https://rustup.rs>.
- macOS / Linux / Windows. Tauri có thêm yêu cầu OS-specific — xem [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Chạy local

```bash
pnpm install                # cài deps cho mọi package trong workspace

# Cách 1 — full desktop app (UI + sidecar + Tauri shell)
pnpm tauri:dev              # build sidecar binary → start Tauri dev → mở webview

# Cách 2 — chỉ UI thuần web (nhanh, không cần Rust)
pnpm dev                    # mở http://localhost:3030 (engine call sẽ no-op)
```

Chi tiết các trang, store, theme: [apps/desktop/ui/README.md](apps/desktop/ui/README.md).

> **Lưu ý.** `pnpm dev` chạy UI ngoài Tauri để dev nhanh — các engine call sẽ không hoạt động (không có sidecar). Để test tích hợp đầy đủ (OAuth, sessions, chat streaming) dùng `pnpm tauri:dev`. Xem [ADR 0006](docs/decisions/0006-tauri-shell-for-nuxt.md), [ADR 0008](docs/decisions/0008-stdio-ipc-for-sidecar.md), [ADR 0011](docs/decisions/0011-anthropic-subscription-oauth.md).

## Trạng thái

M7 (2026-05): Tauri shell + Node.js sidecar đã wire, OAuth Claude Pro/Max hoạt động, `/sessions` chat streaming end-to-end. Tasks/Workflows/Agents/Skills vẫn dùng mock data trong store — đang chờ engine model schema thật. Roadmap chi tiết: [apps/desktop/ui/README.md](apps/desktop/ui/README.md#roadmap).

## Đóng góp

1. Đọc [docs/requirements/](docs/requirements/) để hiểu phạm vi MVP.
2. Đọc [docs/architecture/](docs/architecture/) để nắm runtime model.
3. Tuân thủ [docs/coding/](docs/coding/) khi viết code.
4. Mỗi quyết định kiến trúc lớn ⇒ tạo ADR mới ở [docs/decisions/](docs/decisions/).
