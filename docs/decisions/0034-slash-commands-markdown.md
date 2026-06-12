# 0034 — Slash Commands dưới dạng Markdown (Claude Code-aligned)

- **Trạng thái:** Accepted — **imported claude-* command tiers superseded by [ADR 0035](./0035-consolidate-config-tiers-to-awog.md)** (2026-06-12: `.claude/commands` thành nguồn import-only). Markdown command format + expansion giữ nguyên.
- **Ngày:** 2026-06-11
- **Người quyết định:** Product Owner + Tech Lead (chốt qua trao đổi với user)

## Bối cảnh

Trang **Commands** (slash command cho composer) đã tồn tại trên UI nhưng chỉ là **mock**: model `SlashCommand` giàu (4 type `prompt` / `agent-switch` / `shell` / `workflow` + `args` + `scope` + `aliases` + `system`), state local trong `workspace.ts`, **không persist, không import, không wire runtime** (user gõ `/cmd` không bung ra gì).

Trong khi đó **Rules** ([ADR 0033](./0033-rules-system-prompt-injection.md)) và **Hooks** ([ADR 0032](./0032-hook-execution-engine-ipc-contract.md)) đã là feature thật: 2-tier per-file (global `~/.awog/<kind>` + project `{project}/.awog/<kind>`), import read-only từ Claude Code config, AI create/edit, group-by-project + collapse + i18n, fs-watcher. User yêu cầu "dựa vào những gì vừa triển khai cho rules, hãy hoàn thiện commands".

Slash command **thật** của Claude Code chỉ là file Markdown trong `.claude/commands/*.md` (frontmatter `description` / `argument-hint` / `allowed-tools` / `model` + body prompt template, substitution `$ARGUMENTS` / `$1`…). Model rich cũ **không map được** sang đó → buộc phải chọn hướng.

## Quyết định

**Reshape Command sang model Markdown prompt-template giống Claude Code**, mirror đúng kiến trúc Rules:

1. **2 tier editable:** `global` `~/.awog/commands/<id>.md`, `project` `{project}/.awog/commands/<id>.md`.
2. **2 tier imported (read-only badge, editable in-app):** `claude-user` `~/.claude/commands/**/*.md`, `claude-project` `{project}/.claude/commands/**/*.md`. Subdir namespacing kiểu Claude Code: `frontend/component.md` → id `frontend:component`.
3. **Frontmatter:** `name` (AWOG-only) + `description` + `argument-hint` + `allowed-tools` + `model` + `enabled` (AWOG-only). File imported ghi lại theo **đúng shape Claude Code** (bỏ `name`/`enabled`) để vẫn là CC command hợp lệ.
4. **Bỏ model rich cũ** (agent-switch/shell/workflow + args + scope + aliases + system). Type còn lại = prompt template.
5. **Runtime expansion (chốt thêm):** gõ `/name [args]` trong Session composer → khi gửi, body được bung (substitute `$ARGUMENTS` / `$1`…`$9`) thành prompt gửi cho agent. Expansion **client-side** trong `SessionComposer.onSend` (không đụng sidecar runtime). Autocomplete `/` bổ sung user command (token kind `usercommand`, chèn text — KHÔNG dispatch như session-command mode/compact).

RPC: `commands.{list,upsert,delete,toggle,generate}` (mirror `rules.*`). KHÔNG inject vào system prompt (khác Rules) — command là *invoke theo yêu cầu*, không auto-apply.

## Phương án đã cân nhắc

- **Option A — Markdown như Claude Code (CHỌN):** đúng pattern Rules + interop Claude Code thật (import được `.claude/commands`). Đánh đổi: bỏ model rich cũ (vốn mock, chưa wire runtime nên mất mát thực tế ≈ 0).
- **Option B — Giữ model rich + thêm hạ tầng:** giữ `SlashCommand` 4 type, chỉ thêm persist JSON 2-tier + AI + group/collapse/i18n. Từ chối: **không import được** Claude Code (type rich không có khái niệm tương đương), lệch khỏi yêu cầu "làm như rules", và 3 type kia (agent-switch/shell/workflow) chưa từng wire runtime — giữ lại là phức tạp YAGNI.

## Hệ quả

- **Tích cực:** Command nhất quán hoàn toàn với Rules/Hooks (cùng store/watcher/i18n/AI pattern). Interop Claude Code thật (đọc + ghi `.claude/commands`). Command *thực sự chạy* (bung prompt trong composer). KISS — một shape file duy nhất.
- **Tiêu cực / Trade-off:** Mất 3 type agent-switch/shell/workflow (chưa ai dùng — mock). Nếu sau này cần "command chạy shell/đổi agent", phải thiết kế lại (chấp nhận YAGNI).
- **Việc cần làm tiếp (defer):**
  - Áp `model` / `allowed-tools` override **per-command** khi gửi (hiện chỉ lưu + hiển thị, expansion chưa truyền xuống send path).
  - `@file` / `!bash` substitution kiểu Claude Code (hiện chỉ `$ARGUMENTS` / `$N`).
  - Tách `useCommandsManager` (page vẫn inline) — vi phạm nhẹ rule >250 dòng.
  - Cân nhắc **trust-gate** cho imported project command nếu sau này command tự động chạy lệnh (hiện chỉ bung text → rủi ro thấp như Rules).

## Tham chiếu

- [ADR 0033 — Rules injection](./0033-rules-system-prompt-injection.md) (kiến trúc mirror)
- [ADR 0032 — Hook execution engine](./0032-hook-execution-engine-ipc-contract.md) (2-tier + import + trust pattern)
- [docs/features/slash-commands.md](../features/slash-commands.md)
- Claude Code slash commands: `.claude/commands/*.md`
