# Feature: Skill Builder

**Trạng thái:** Implemented (P1–P3, P4 polish defer)

## Overview

Skill là **một folder chứa SKILL.md** (YAML frontmatter + markdown body), cùng định dạng với Claude Code SDK và [craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss). Format đồng nhất → skill viết bởi AWOG dùng được ngay trong Claude Code / Craft Agents và ngược lại. Xem [ADR 0013](../decisions/0013-adopt-skill-md-format.md) cho quyết định pivot.

Khi agent A tham gia session, `A.skillIds` trở thành capability khả dụng cho turn đó. Skill cũng có thể được invoke explicit qua `/slug` slash command, hoặc auto-suggest qua `globs` (P4).

## SKILL.md format

```yaml
---
name: Code Review
description: Review code changes for quality and security
globs: ["*.ts", "*.tsx"]          # optional, file patterns auto-suggest skill
alwaysAllow: ["Bash"]              # optional, tool names pre-approved
icon: "🔍"                         # optional, emoji or URL
requiredSources: ["github"]        # optional, source slugs auto-enable
---

# Skill body (markdown)
Concrete instructions for Claude when this skill is active...
```

Required: `name`, `description`. Tất cả còn lại optional.

## Source tiers (5)

| Source | Path | Khi nào dùng |
|---|---|---|
| `global` | `~/.awog/skills/<slug>/SKILL.md` | AWOG-native, dùng khắp nơi (default cho skill mới) |
| `user-claude` | `~/.claude/skills/<slug>/SKILL.md` | Chia sẻ với Claude Code SDK install local |
| `user-agents` | `~/.agents/skills/<slug>/SKILL.md` | Chia sẻ với Craft Agents install local |
| `project-claude` | `{project.path}/.claude/skills/<slug>/SKILL.md` | Scope theo project (commit vào git repo) |
| `project-agents` | `{project.path}/.agents/skills/<slug>/SKILL.md` | Scope theo project (Craft convention) |

3 tier user-level **luôn được scan**. 2 tier project được scan theo `projectIds[]` truyền vào `skills.list` (mặc định UI truyền toàn bộ `ws.projects`).

## User Stories

- **Tạo skill bằng chat**: click "+ New" → mini chat trong modal → mô tả yêu cầu → LLM dùng Write tool tự tạo folder + SKILL.md. Iterate qua thêm message ("rename slug to X", "shorten body").
- **Edit body bằng prompt**: skill detail → "Edit" button → modal prompt-driven → LLM revise body giữ id/source.
- **Edit form-based**: skill detail → "Edit" button trên header → form đầy đủ (slug, source, name, description, globs, alwaysAllow, icon, requiredSources, body markdown).
- **Inline rename**: double-click tên skill trong list → Enter để save.
- **Bulk delete**: tick checkbox nhiều skill → floating bar dưới màn → confirm modal liệt kê 5 đầu → loop delete với summary toast.
- **Refresh**: nút sync → re-scan toàn bộ 5 tier, toast hiển thị paths thực sự scan + count.

## UI components

| Component | Vai trò |
|---|---|
| [pages/skills/index.vue](../../apps/desktop/ui/pages/skills/index.vue) | List + detail master-detail shell. Source badge, bulk select, refresh button, toast container |
| [components/skill/SkillDetail.vue](../../apps/desktop/ui/components/skill/SkillDetail.vue) | Detail view với preview/raw toggle + Copy + Edit (LLM prompt) button. MarkdownRenderer cho preview |
| [components/skill/SkillEditor.vue](../../apps/desktop/ui/components/skill/SkillEditor.vue) | Form đầy đủ. Source picker locked khi edit existing (đổi tier = phải tạo lại) |
| [components/skill/SkillPromptCreator.vue](../../apps/desktop/ui/components/skill/SkillPromptCreator.vue) | Mini chat surface. Multi-turn, streaming, agent dùng Write tool tự tạo SKILL.md |
| [components/skill/SkillBodyEditModal.vue](../../apps/desktop/ui/components/skill/SkillBodyEditModal.vue) | Floating prompt panel để revise body skill có sẵn |

## Sidecar RPC

| Method | File | Behavior |
|---|---|---|
| `skills.list({ projectIds? })` | [methods/skills.list.ts](../../apps/desktop/sidecar/src/methods/skills.list.ts) | Scan 3 user tiers + project tiers per id. Trả `{ skills, reports }` — `reports[].dir/source/found` để UI diagnose path thực tế. |
| `skills.upsert({ skill, mode, previousId? })` | [methods/skills.upsert.ts](../../apps/desktop/sidecar/src/methods/skills.upsert.ts) | Atomic write `SKILL.md.tmp + rename`. Rename slug → di chuyển folder. |
| `skills.delete({ id, source, projectId? })` | [methods/skills.delete.ts](../../apps/desktop/sidecar/src/methods/skills.delete.ts) | `rm -rf` folder. Logical delete only, không gỡ reference ở agent.skillIds. |
| `skills.generate({ prompt, accountId?, currentSkill? })` | [methods/skills.generate.ts](../../apps/desktop/sidecar/src/methods/skills.generate.ts) | One-shot LLM call. Khi `currentSkill` có mặt → edit mode (revise existing). Trả structured JSON. |
| `skills.author({ messageId, history[], userText, accountId?, projectIds? })` | [methods/skills.author.ts](../../apps/desktop/sidecar/src/methods/skills.author.ts) | Chat-style multi-turn với Write tool enabled. Stream `skills.author.chunk/step/done` events. LLM tự tạo SKILL.md trên disk. |

Sidecar storage: [skills/store.ts](../../apps/desktop/sidecar/src/skills/store.ts) + [skills/frontmatter.ts](../../apps/desktop/sidecar/src/skills/frontmatter.ts) (minimal YAML parser/serializer, không thêm dep).

## Skill type (UI + sidecar mirror)

```ts
type SkillSource = 'global' | 'user-claude' | 'user-agents' | 'project-claude' | 'project-agents'

interface Skill {
  id: string                 // = slug, folder name on disk
  source: SkillSource
  projectId?: string         // required khi source là project-*
  name: string               // frontmatter.name
  description: string        // frontmatter.description
  body: string               // markdown sau frontmatter
  globs?: string[]
  alwaysAllow?: string[]
  icon?: string              // emoji hoặc URL
  requiredSources?: string[]
}
```

Identity tuple: `(source, projectId, id)`. Cùng slug có thể tồn tại độc lập ở các tier khác nhau — UI dùng composite key `${source}|${projectId ?? ''}|${id}` để dedupe selection state.

## Mention conventions (session composer)

| Trigger | Ý nghĩa |
|---|---|
| `@path/file.md` | Reference file workspace — **live**: fuzzy toàn cây file thật qua `fs.listFiles` (git ls-files + walk fallback), cache per `workspaceRoot`, top 50 + đếm khi còn nữa. Rỗng nếu session chưa gắn project / không có sidecar. |
| `$agent-name` | Invoke agent → expand `agent.skillIds` auto-active |
| `/slug` | Explicit skill invocation (hợp nhất với COMMANDS list) |

`@` lấy `workspaceRoot` từ `session.projectId`; index cache ở [composables/useWorkspaceFileIndex.ts](../../apps/desktop/ui/composables/useWorkspaceFileIndex.ts). Chi tiết: [sessions.md → Mention](sessions.md). State machine: [composables/useMentionAutocomplete.ts](../../apps/desktop/ui/composables/useMentionAutocomplete.ts).

## LLM integration

- **Generator mock fallback**: khi không có sidecar hoặc chưa connect Anthropic account → slugify prompt + dùng làm body. UX vẫn dùng được offline.
- **`skills.generate`**: model default `claude-haiku-4-5`, system prompt bắt LLM trả JSON đúng schema, validate bằng zod.
- **`skills.author`**: model default `claude-sonnet-4-6` (cần Write tool), system prompt liệt kê 5 paths được phép write + workflow 5 bước (ask if vague → slug → pick path → Write tool → 1-line confirm). `permissionMode: 'bypassPermissions'` vì user explicit mở "skill author" mode.

## Toast notifications

Toàn bộ action có toast success/error:
- **Refresh**: `Loaded N skills` / `No skills found · scanned <paths>` / error
- **Save** (form + rename slug): `Saved /<slug>` / `Renamed to /<slug>` / error
- **Inline rename**: `Renamed /<slug> → "name"` / error
- **Body edit (LLM)**: `Skill updated` / error
- **Delete single**: `Deleted /<slug>` / error
- **Bulk delete**: `Deleted N skills` / partial: `Deleted X, failed Y` / all failed

## Cascade & integrity (P2 — hiện tại one-way only)

- **Delete** skill X → UI giữ orphan `Agent.skillIds` chứa X (chưa cascade clean). Workflow node với `skillId: X` render warning ("unknown skill").
- **Rename slug** → UI chưa update reference ở agent/workflow tự động.

Defer: cascade update khi delete/rename sẽ vào P2 follow-up nếu cần (xem ADR 0013 — Việc cần làm tiếp).

## Phụ thuộc

- [artifact-system](./artifact-system.md) — skill body có thể reference artifact paths.
- [agent-builder](./agent-builder.md) — `Agent.skillIds[]` reference theo slug.
- [sessions](./sessions.md) — session runner inject skill body vào systemPrompt (P3 partial — chưa wire chính thức vào sessions.send-message).

## Đã đóng

- ✅ Format SKILL.md (P1) — adopt Claude Code SDK / Craft Agents convention
- ✅ Sidecar storage + RPC (P1)
- ✅ UI editor + chat-driven creation (P3 — vượt scope ban đầu, dùng claude-agent-sdk Write tool)
- ✅ Body edit via LLM prompt (P3)
- ✅ Bulk delete, refresh button, toast feedback
- ✅ 5-tier discovery (global + 2 user-level external + 2 project-level)

## Còn mở

- **Cascade agent.skillIds / workflow.skillId** khi rename hoặc delete skill
- **Glob auto-trigger** khi session reference file path match (P4)
- **requiredSources** auto-enable connector (AWOG chưa có "source" concept formal)
- **openEditor / openFinder** RPC (mở SKILL.md ở OS editor) — Tauri shell.open
- **Session runner inject** skill body vào systemPrompt khi `$agent` được invoke (hiện sessions.send-message chưa wire P3)
- **Icon URL download** (frontmatter.icon = URL → sidecar download `<dir>/icon.{ext}`)
