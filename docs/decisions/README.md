# Architecture Decision Records (ADR)

Thư mục này lưu các quyết định kiến trúc quan trọng của AWOG. Mỗi ADR ghi lại **đã quyết định gì**, **tại sao**, và **các phương án thay thế** đã cân nhắc, để người đóng góp sau này hiểu lý do đằng sau codebase.

## Danh mục

| # | Tiêu đề | Trạng thái |
|---|---|---|
| [0001](./0001-local-first-storage.md) | Lưu trữ filesystem local-first (không database trong MVP) | Accepted |
| [0002](./0002-git-as-version-control.md) | Dùng Git cho artifact versioning | Accepted |
| [0003](./0003-nuxt-fullstack.md) | Nuxt 4 làm frontend + server hợp nhất | Superseded by 0006 |
| [0004](./0004-artifacts-as-source-of-truth.md) | Artifact là cơ chế chính để các agent cộng tác | Accepted |
| [0005](./0005-isolated-agent-sessions.md) | Mỗi agent có session độc lập | Accepted |
| [0006](./0006-tauri-shell-for-nuxt.md) | Tauri làm shell đóng gói cho Nuxt | Accepted |
| [0007](./0007-bundle-nodejs-runtime.md) | Bundle Node.js runtime cùng binary | Accepted |
| [0008](./0008-stdio-ipc-for-sidecar.md) | Stdio IPC giữa Tauri shell và Node.js sidecar | Accepted |
| [0009](./0009-dev-mode-http-fallback.md) | Dev-mode HTTP fallback cho sidecar | Accepted |
| [0010](./0010-pause-on-quota-for-connection-switch.md) | Pause-on-quota để cho phép switch connection thủ công | Accepted |
| [0011](./0011-anthropic-subscription-oauth.md) | Anthropic subscription OAuth flow | Accepted |
| [0012](./0012-projects-storage.md) | Lưu trữ projects bằng plain JSON per-file | Accepted |
| [0013](./0013-adopt-skill-md-format.md) | Adopt SKILL.md format for skills (Claude Code SDK / craft-agents-oss compatible) | Accepted |
| [0014](./0014-mcp-servers-stdio-runtime.md) | MCP servers runtime: stdio-only pha 1, per-file JSON, in-sidecar process group | Accepted |
| [0015](./0015-agents-persisted-runtime-systemprompt.md) | Agents: per-file JSON persistence + systemPrompt runtime override | Accepted |
| [0016](./0016-deprecate-context-providers-fold-into-mcp.md) | Deprecate Context Providers, fold into MCP Servers | Accepted |
| [0017](./0017-git-manager-ipc-contract.md) | Git Manager IPC contract — chốt 12 open question cho sidecar wiring | Accepted |
| [0018](./0018-mcp-secret-keychain.md) | MCP secret storage: OS keychain via `@napi-rs/keyring` | Accepted |
| [0019](./0019-pty-terminal-in-sidecar.md) | PTY terminal trong sidecar (node-pty) cho Workspace Panel | Accepted |
| [0020](./0020-highlightjs-code-rendering.md) | Syntax-highlight code block trong chat bằng highlight.js | Accepted |
| [0021](./0021-monaco-code-editor.md) | Monaco làm code editor cho in-app Project Workspace | Proposed |
| [0022](./0022-fs-read-write-search-ipc.md) | Mở rộng `fs.*` IPC: read-write + search cho project workspace | Proposed |
| [0023](./0023-sdk-session-resume-and-compact.md) | SDK session resume + `/compact` (bỏ transcript-flattening) | Proposed |
| [0024](./0024-task-execution-engine-ipc-contract.md) | Task Execution Engine + Workflow IPC contract | Accepted |
| [0025](./0025-connections-manager.md) | Connections Manager (đổi tên MCP Servers → Connections) | Amended — Simplified |
| [0026](./0026-per-agent-multi-provider-llm.md) | Per-agent multi-provider LLM | Accepted (Phase C còn lại) |
| [0027](./0027-tauri-vs-electron-revisit.md) | Tauri vs Electron revisit | Accepted — Option B (Electron) |
| [0028](./0028-auto-update.md) | Auto-update | Accepted — Option A (electron-updater) |
| [0029](./0029-migrate-llm-runtime-to-pi-sdk.md) | Migrate LLM runtime sang Pi SDK | Accepted (C2 amended by 0059) |
| [0030](./0030-subagent-task-tool.md) | Subagent `Task` tool | Accepted |
| [0031](./0031-rtk-token-proxy.md) | Bundle RTK (Rust Token Killer) làm bộ nén output cho Bash tool | Reverted (2026-06-15) |
| [0032](./0032-hook-execution-engine-ipc-contract.md) | Hook Execution Engine + IPC contract | Accepted |
| [0032](./0032-session-message-parts-model.md) | Session message parts model | Accepted |
| [0033](./0033-rules-system-prompt-injection.md) | Rules — workspace instruction injection vào system prompt | Accepted |
| [0034](./0034-slash-commands-markdown.md) | Slash Commands dưới dạng Markdown (Claude Code-aligned) | Accepted |
| [0035](./0035-consolidate-config-tiers-to-awog.md) | Quy hoạch lại lưu trữ config-entity về `.awog` (single editable tier) | Accepted |
| [0036](./0036-project-templates.md) | Project Templates (bundle config tái dùng + install) | Accepted |
| [0037](./0037-remote-template-fetch-github.md) | Fetch Project Templates từ folder GitHub (public) | Accepted |
| [0038](./0038-session-rewind-fs-snapshots.md) | Rewind cho Session bằng filesystem snapshot | Accepted |
| [0039](./0039-tray-account-usage-channel.md) | Tray account-usage state channel (`tray:setState`) + main-side notification | Accepted (phần kỹ thuật) |
| [0040](./0040-git-branch-ops-merge-rebase-pr.md) | Git branch ops: merge/rebase trong sidecar, Create PR qua browser | Accepted |
| [0059](./0059-creator-flow-through-session-runtime.md) | Chạy luồng creator (*.author) qua session runtime | Proposed |
| [0060](./0060-connections-adopt-craft-sources-model.md) | Connections áp dụng mô hình "Sources" của Craft | Accepted |
| [0061](./0061-session-craft-parity-render-model.md) | Session UI áp dụng model turn/activity + render pipeline của Craft | Accepted |
| [0062](./0062-adopt-craft-session-storage-model.md) | Session storage áp dụng mô hình lưu + nạp của Craft (header + messages, warm cache) — amend 0048 | Accepted |
| [0067](./0067-mobile-remote-control-transport.md) | Transport điều khiển session từ điện thoại = Tailscale/WireGuard mesh + Remote Gateway | Proposed |
| [0070](./0070-share-claude-home-for-config.md) | Dùng chung `.claude` làm nhà cho skills/agents/commands | Accepted |
| [0071](./0071-senior-engineer-prompt-core.md) | Lõi prompt cấp senior: orientation, quy trình, dẫn chứng (2 runtime) | Accepted |
| [0073](./0073-wiki-as-llm-context-source.md) | Wiki nội bộ làm nguồn context cho LLM (+ bộ nhớ AI): store 2 tier ở `.awog`, inject mục lục + đọc theo yêu cầu qua tool | Proposed |

> Lưu ý: số `0032` bị trùng (hai quyết định độc lập landed cùng đợt). Số mới không tái sử dụng — ADR kế tiếp dùng số tăng dần. Các ADR 0041–0058 và 0063–0066 đã tồn tại trong thư mục nhưng bảng này chưa backfill (index đang lạc hậu); ADR kế tiếp sau 0059 dùng 0060. ADR 0062 **amend** ADR 0048 (thay `index.json` bằng header per-file + warm cache); ADR 0070 **supersede** phần nhà-lưu-trữ của ADR 0035 (skills/agents/commands chuyển sang `.claude` dùng chung); ADR kế tiếp sau 0073 dùng 0074.

## Template

Dùng [`template.md`](./template.md) làm điểm bắt đầu cho ADR mới.

## Quy ước

- Tên file: `NNNN-kebab-case-title.md`, đánh số tuần tự với padding 0.
- Giá trị trạng thái: **Proposed**, **Accepted**, **Deprecated**, **Superseded by NNNN**.
- Sau khi Accepted, nội dung ADR là **bất biến** — thay bằng ADR mới chứ không sửa lại.
- Mỗi ADR tập trung vào một quyết định duy nhất.
