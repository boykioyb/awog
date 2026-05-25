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
| Desktop shell | Tauri (Rust) — system tray, notification, lifecycle |
| Frontend | Nuxt 4 + Vue 3 + TypeScript + Pinia + VueFlow + TailwindCSS + Monaco |
| Engine | Node.js sidecar (Nuxt server API + execution engine) |
| LLM client | Anthropic SDK, OpenAI SDK (+ Gemini, local model qua adapter) |
| Storage | Local filesystem (JSON / YAML / Markdown) + Git |

Chi tiết: [docs/architecture/system-overview.md](docs/architecture/system-overview.md), [docs/architecture/tech-stack.md](docs/architecture/tech-stack.md).

## Cấu trúc repo

```
awog/
├── apps/
│   └── desktop/
│       └── ui/              # Nuxt 4 frontend (xem apps/desktop/ui/README.md)
├── artifacts/
│   └── VISION.md            # Tầm nhìn sản phẩm
├── docs/
│   ├── requirements/        # Yêu cầu (functional, non-functional, MVP scope)
│   ├── design/              # UX flow, wireframe, visual reference
│   ├── architecture/        # System overview, data model, execution model, tech stack
│   ├── decisions/           # ADR — kiến trúc, công nghệ, scope
│   ├── features/            # Đặc tả theo feature
│   └── coding/              # Quy ước code (general + nuxt-frontend, sẽ thêm node/tauri)
├── CLAUDE.md                # Hướng dẫn cho Claude Code khi làm việc trên repo này
├── MEMORY.md                # Index memory cho ngữ cảnh dự án (Claude Code)
└── README.md
```

## Chạy local (UI)

```bash
cd apps/desktop/ui
pnpm install        # hoặc npm install
pnpm dev            # mở http://localhost:3030 → redirect /tasks
```

Chi tiết các trang, store, theme: [apps/desktop/ui/README.md](apps/desktop/ui/README.md).

> **Lưu ý.** UI hiện chạy thuần web để phát triển. Khi tích hợp Tauri shell, UI sẽ load qua webview từ Node.js sidecar — xem [ADR 0006](docs/decisions/0006-tauri-shell-for-nuxt.md), [ADR 0008](docs/decisions/0008-stdio-ipc-for-sidecar.md).

## Trạng thái

MVP đang ở giai đoạn port UI prototype (React → Nuxt 4). Engine, Tauri shell và Node.js sidecar chưa được wire — UI hiện chạy với mock data trong store. Roadmap chi tiết: [apps/desktop/ui/README.md](apps/desktop/ui/README.md#roadmap-sau-khi-port-done).

## Đóng góp

1. Đọc [docs/requirements/](docs/requirements/) để hiểu phạm vi MVP.
2. Đọc [docs/architecture/](docs/architecture/) để nắm runtime model.
3. Tuân thủ [docs/coding/](docs/coding/) khi viết code.
4. Mỗi quyết định kiến trúc lớn ⇒ tạo ADR mới ở [docs/decisions/](docs/decisions/).
