# Feature — Slash Commands

- **Trạng thái:** Implemented (2026-06-11)
- **ADR:** [0034 — Slash Commands dưới dạng Markdown](../decisions/0034-slash-commands-markdown.md)
- **Liên quan:** [Rules](./rules.md), [Hooks](./hooks.md)

> **Lưu ý lịch sử:** bản draft đầu (model rich 4 type `prompt`/`agent-switch`/`shell`/`workflow` + args + scope) đã bị **superseded bởi ADR 0034** — chuyển sang model Markdown prompt-template giống Claude Code. Tài liệu này mô tả bản đã implement.

## Tổng quan

Slash command là **prompt template tái dùng**: user gõ `/<name> [args]` trong Session composer; khi gửi, body command được bung thành prompt gửi cho agent. Đây là bản AWOG-native của Claude Code `.claude/commands/*.md`. Trang **Commands** trên NavRail (icon Slash, route `/commands`) để quản lý.

## Mô hình lưu trữ (mirror Rules — ADR 0033)

Mỗi command là một file Markdown (YAML frontmatter + body). 4 tier:

| Source | Vị trí | Sửa/Xóa |
|---|---|---|
| `global` | `~/.awog/commands/<id>.md` | sửa + xóa |
| `project` | `{project}/.awog/commands/<id>.md` | sửa + xóa (đi theo Git) |
| `claude-user` | `~/.claude/commands/**/*.md` | sửa (ghi đè file gốc), KHÔNG xóa |
| `claude-project` | `{project}/.claude/commands/**/*.md` | sửa (ghi đè file gốc), KHÔNG xóa |

- `source`/`projectId` **suy ra từ vị trí**, không ghi vào file.
- **Namespacing** kiểu Claude Code: `.claude/commands/frontend/component.md` → id `frontend:component`. Scan đệ quy (depth ≤ 3).
- Frontmatter: `name` (chỉ AWOG-native), `description`, `argument-hint`, `allowed-tools`, `model`, `enabled` (chỉ AWOG-native). File imported ghi lại theo **shape Claude Code** (bỏ `name`/`enabled`) để vẫn là CC command hợp lệ.
- Imported = `readOnly: true` (badge Lock), luôn `enabled`; sửa được nội dung trong app, ghi đè ngược vào file `.claude/commands`.

## Expansion (runtime)

- Gõ `/name` trong composer → autocomplete `/` gợi ý (cùng chỗ với session-command `/plan`,`/compact` + skills). Pick → chèn `/id ` (text, KHÔNG dispatch).
- Khi **gửi** (`SessionComposer.onSend`): nếu draft là `/name [args]` khớp một command **enabled** trong scope (global/claude-user luôn; project/claude-project khi session gắn đúng project) → bung body:
  - `$ARGUMENTS` → toàn bộ phần text sau name.
  - `$1`…`$9` → tham số theo vị trí (tách theo khoảng trắng). Thiếu → rỗng.
  - Body không có token → args bị bỏ qua (giống Claude Code; KHÔNG auto-append).
- Expansion **client-side** thuần (`utils/slash-command.ts`), không đụng sidecar runtime. Message gửi đi/persist là prompt đã bung.

## AI create / edit

- **Create:** "New command" mở `CommandPromptCreator` (Create with AI) → `commands.generate` (completePi, model haiku, JSON `{name,description,argumentHint,body}`, fallback mock). "Edit details" → `CommandEditor` seed sẵn.
- **Edit:** `CommandDetail` → MarkdownBodyView `allow-edit` → `CommandBodyEditModal` (`commands.generate` với `currentCommand` → revise) → `ws.saveCommand`. Chạy cho cả imported.

## IPC (RPC methods)

| Method | Vai trò |
|---|---|
| `commands.list` | `{projectIds?}` → `{commands, reports}` (scan report per-tier) |
| `commands.upsert` | `{command, mode}` — imported bỏ qua create/existence, ghi đè file gốc |
| `commands.delete` | chỉ `global`/`project` (chặn xóa file Claude Code) |
| `commands.toggle` | chỉ `global`/`project` (imported không có `enabled`) |
| `commands.generate` | one-shot LLM draft/revise |

Watcher emit `commands.fs-changed` (watch `~/.awog/commands`, `~/.claude/commands`, `{project}/.awog/commands`, `{project}/.claude/commands`; relevantFile `.md`).

## Data model

```ts
type CommandSource = 'global' | 'project' | 'claude-project' | 'claude-user'

interface Command {
  id: string          // slug = name sau '/', namespacing dùng ':'
  name: string
  description: string
  body: string        // prompt template ($ARGUMENTS / $1…$9)
  argumentHint?: string
  allowedTools?: string
  model?: string
  enabled: boolean
  source?: CommandSource
  projectId?: string
  readOnly?: boolean  // imported
}
```

## UI/UX

- `pages/commands/index.vue` mirror trang Rules: search/refresh + scan-report toast/empty; **group theo project + collapse** (header `font-semibold`, color `t.text`); **composite key** `source|projectId|id` cho selection (tránh trùng id highlight); source badge; imported badge Lock + ẩn Delete; i18n en/vi đầy đủ (`commands.*`).
- Component: `CommandDetail`, `CommandEditor` (source picker, slug, name, description, argument-hint, model, allowed-tools, template, enabled), `CommandPromptCreator`, `CommandBodyEditModal`.

## Bảo mật

- Command chỉ **bung text** thành prompt (không spawn shell/exec) → rủi ro thấp như Rules. Không có template eval JS.
- Imported edit ghi đè đúng file `.claude/commands` (atomic tmp+rename, chmod 600). Delete chặn với mọi tier imported.
- `commands.generate` đi qua sidecar (API key không rời sidecar — invariant 1).

## Out of scope (defer)

- Áp `model` / `allowed-tools` override **per-command** khi gửi (hiện chỉ lưu + hiển thị).
- `@file` / `!bash` substitution kiểu Claude Code (hiện chỉ `$ARGUMENTS` / `$N`).
- Command type "shell/agent-switch/workflow" (bỏ khỏi model rich cũ — ADR 0034).
- Trust-gate cho imported project command (rủi ro thấp vì chỉ bung text).
- Tách `useCommandsManager` (page còn inline — vi phạm nhẹ rule >250 dòng).
