# Feature: Rules

**Trạng thái:** v1 implemented — contract: [ADR 0033](../decisions/0033-rules-system-prompt-injection.md)

## Overview

Rule là **file instruction (Markdown)** người dùng soạn, **tự động chèn vào system prompt** của agent ở mọi session + task. Đây là bản AWOG-native của `CLAUDE.md` / `.claude/rules/*.md` — nơi đặt quy ước/chính sách xuyên suốt (coding style, định dạng output, ràng buộc bảo mật…) mà không phải sửa từng AGENT.md.

## User Stories

- Là người dùng, tôi muốn mọi agent đều theo coding style của tôi (2-space, no semicolons) mà không nhắc lại mỗi lần.
- Là người dùng, tôi muốn rule riêng cho 1 project (đi theo repo) và rule chung cho mọi project.
- Là người dùng, tôi muốn bật/tắt nhanh một rule mà không xóa nó.

## Functional Behavior

- **Nguồn (5 tier, D-4 amended):**
  - **Editable (AWOG-native):** `global` `~/.awog/rules/<id>.md` (áp mọi nơi), `project` `{project}/.awog/rules/<id>.md` (áp session/task của project).
  - **Imported read-only (Claude Code):** `claude-project` `{project}/CLAUDE.md`, `claude-rules` `{project}/.claude/rules/*.md`, `claude-user` `~/.claude/CLAUDE.md`. `readOnly:true`, luôn enabled, không edit/xóa/toggle trong app (sửa file gốc).
- **Inject (D-2/D-3):** mọi rule áp dụng được nối lại, bọc `<workspace-rules>`, **append** vào `systemPromptAppend` (augment, không thay `agent.systemPrompt` — [ADR 0015](../decisions/0015-agents-persisted-runtime-systemprompt.md)). Áp **Sessions + Tasks**.
- **Ưu tiên CLAUDE.md:** thứ tự trong prompt = `claude-project` → `claude-rules` → `claude-user` → `project` → `global`.
- **Disabled** (chỉ AWOG-native) không inject; imported luôn inject.
- **Live:** `rules.fs-changed` (watch `~/.awog/rules`, `{project}/.awog/rules`, `{project}/.claude/rules`) → UI re-hydrate. CLAUDE.md (file gốc) cập nhật khi Refresh/restart.

## Data Model

File Markdown (YAML frontmatter + body), tái dùng parser [`skills/frontmatter.ts`](../../apps/desktop/sidecar/src/skills/frontmatter.ts):

```markdown
---
name: Code style
description: Project coding conventions
enabled: true
---
Always use 2-space indent. No semicolons in TS. Prefer composition over inheritance.
```

`source`/`projectId` suy ra từ vị trí file (không ghi vào file). RPC: `rules.{list,upsert,delete,toggle}`.

## UI/UX Notes

- Tab **Rules** (NavRail). Trang master-detail (mirror Skills/Hooks): search + **Refresh** (scan report toast) + **New**; empty state; badge `project` cho rule tier project.
- **RuleEditor:** source picker global/project (+ project select), slug auto từ name, name, description, body (markdown textarea), Enabled toggle.
- **RuleDetail:** header + source badge + disabled badge; toggle Enabled; body qua [`MarkdownBodyView`](../../apps/desktop/ui/components/markdown/MarkdownBodyView.vue) (preview/raw/copy).

## Dependencies

- [agent-builder](./agent-builder.md) — rule **append** sau `agent.systemPrompt`, không thay thế.
- [session-system](./session-system.md) + [task-execution-engine](./task-execution-engine.md) — điểm inject.

## Out of Scope (v1)

- **Glob/path-scoped rules** (chỉ áp khi sửa file khớp) — defer ([ADR 0033](../decisions/0033-rules-system-prompt-injection.md) D-5).
- **CLAUDE.md `@import` directive** — body được inject nguyên văn; chưa resolve `@path` import (như Claude Code).
- **Live-watch CLAUDE.md file gốc** — `.claude/rules` được watch; CLAUDE.md refresh-driven.
- **Token budget / trim** rule dài.
- **Trust-gate cho project rule / imported** (như hook D-8) — cân nhắc trước release (prompt-injection).

## Open Questions

- Có cần trust/preview cho project rule (repo clone về) trước khi inject không?
- Thứ tự inject khi nhiều rule mâu thuẫn — hiện sort theo name; có cần priority?
- Có nên cho rule tham chiếu file (`@path`) như CLAUDE.md import không?
