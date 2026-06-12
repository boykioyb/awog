# 0013 — Adopt SKILL.md format for skills (Claude Code SDK / craft-agents-oss compatible)

- **Trạng thái:** Accepted — **tier model superseded by [ADR 0035](./0035-consolidate-config-tiers-to-awog.md)** (2026-06-12: `.awog` only, 2 tier global/project; `.claude`/`.agents` thành nguồn import). SKILL.md format giữ nguyên.
- **Ngày:** 2026-05-28
- **Người quyết định:** Product owner + tech lead

## Bối cảnh

Skill type ban đầu (sơ phác trong [data-model.md](../architecture/data-model.md) cũ + [skill-builder.md](../features/skill-builder.md) cũ) là JSON với fields `{ id, name, category, description, inputs[], outputs[], promptTemplate, tags[] }`. Mục đích cho workflow DAG: mỗi node = 1 skill, edge match outputs → inputs.

Khi adopt `@anthropic-ai/claude-agent-sdk` cho sessions (commit b432ae3) thì SDK đã có concept skill native: file `SKILL.md` với YAML frontmatter (name, description, globs, alwaysAllow, requiredSources, icon) + markdown body chứa instruction cho agent. [craft-ai-agents/craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss) dùng **chính xác cùng format**, thư mục `~/.agents/skills/<slug>/SKILL.md`.

Câu hỏi: tiếp tục model JSON tự định nghĩa, hay pivot sang SKILL.md để tương thích với hệ sinh thái Claude Code / Craft Agents?

## Quyết định

Adopt **SKILL.md folder format** đồng nhất với Claude Code SDK & craft-agents-oss. Skill là folder chứa `SKILL.md` (frontmatter + markdown body) + optional `icon.{svg,png,jpg}`. AWOG-native skill lưu ở `~/.awog/skills/<slug>/SKILL.md`. Đồng thời auto-discover skill từ 4 path khác (user-level `~/.claude/skills/`, `~/.agents/skills/`; project-level `<project>/.claude/skills/`, `<project>/.agents/skills/`).

Skill type:
```ts
type SkillSource = 'global' | 'user-claude' | 'user-agents' | 'project-claude' | 'project-agents'

interface Skill {
  id: string                 // = slug, folder name
  source: SkillSource
  projectId?: string
  name: string
  description: string
  body: string
  globs?: string[]
  alwaysAllow?: string[]
  icon?: string
  requiredSources?: string[]
}
```

Identity tuple: `(source, projectId, id)`.

## Phương án đã cân nhắc

- **Option A — Giữ model JSON cũ** (`category/inputs/outputs/promptTemplate/tags`). Workflow DAG có type-checking edge tự nhiên. Nhưng skill viết bởi AWOG không dùng được trong Claude Code SDK / Craft Agents (và ngược lại). Duy trì format riêng = tự cô lập khỏi ecosystem đang lớn nhanh.

- **Option B — Đề xuất bỏ workflow DAG, dùng SKILL.md** (đã chọn). File interchangeable với 2 SDK lớn → user copy skill từ community, dùng AWOG editor để chỉnh, rồi commit vào `.claude/skills/` của project để share team. Trade-off: mất type-safety edge ở workflow → giải bằng warning thay vì block khi `skillId` không match expected outputs (defer).

- **Option C — Hybrid**: Giữ JSON cho workflow skills + thêm SKILL.md cho session skills. Phức tạp gấp đôi, 2 concept skill song song. Reject.

- **Option D — SKILL.md nhưng chỉ scan `~/.awog/skills/`**: format compat nhưng không discover external. User vẫn phải copy thủ công. Bỏ qua giá trị chính của Option B. Reject.

## Hệ quả

### Tích cực

- **Format interchangeable**: skill viết bởi AWOG dùng được ngay trong Claude Code / Craft Agents. Skill từ community ([anthropic-cookbook](https://github.com/anthropics/claude-cookbooks), Craft Agents marketplace) discover được tự động khi user clone về `~/.claude/skills/` hoặc trong project's `.claude/skills/`.
- **Format đã được battle-tested** bởi Claude Code SDK ecosystem (frontmatter fields cho globs / alwaysAllow / icon / requiredSources đã có rationale + reference impl).
- **5-tier discovery** scope tự nhiên: AWOG-native (private), user-shared (Claude Code / Craft Agents installs), project (commit cùng repo).
- **YAML frontmatter parser inline** trong sidecar (~120 LOC, không cần dep `gray-matter` / `yaml`) — đủ cho subset AWOG cần (flat key:value, string array).
- **LLM tự tạo skill** qua chat (`skills.author` RPC): LLM nhận system prompt liệt kê 5 paths, dùng Write tool của claude-agent-sdk để materialize file trực tiếp trên disk. Skill creation = real conversation chứ không phải form submit.

### Tiêu cực / Trade-off

- **Breaking change** cho Skill type cũ. Mock data (12 default skills) bị bỏ vì map không trọn vẹn (`category/inputs/outputs/promptTemplate` không có chỗ trong SKILL.md). Workflow nodes có sẵn với `skillId: 'sk1'...` trở thành orphan reference (UI render warning, không crash).
- **Workflow type-check** (edge match outputs → inputs) bị mất. Defer: nếu cần lại, sẽ thêm extra metadata trong frontmatter (vd `inputs:` / `outputs:`) hoặc backport vào AWOG-only field — chấp nhận divergence ở chỗ đó.
- **Identity tuple phức tạp hơn** id đơn `(source, projectId, id)` — UI cần composite key (`${source}|${projectId ?? ''}|${id}`) cho dedupe selection.
- **`Agent.skillIds[]`** dùng slug làm reference, không track tier → resolution theo priority chain `project > user > global` (defer implement; hiện UI scan flat).

### Việc cần làm tiếp

1. **Cascade reference** khi rename slug / delete skill: update `Agent.skillIds[]` và `Workflow.nodes[].skillId`. Hiện chưa wire — defer cho khi cần.
2. **Session runner inject** skill body vào systemPrompt khi `$agent` được invoke (P3 chưa wire sessions.send-message).
3. **Glob auto-trigger** (P4): khi user reference file path match `globs`, suggest skill ở UI composer.
4. **Icon URL download** (P4): khi `frontmatter.icon` là URL → sidecar download về `<dir>/icon.{ext}`.
5. **openEditor / openFinder RPC** (P4): mở SKILL.md ở OS editor qua Tauri shell.

## Tham chiếu

- Feature spec: [skill-builder.md](../features/skill-builder.md)
- Data model: [data-model.md#skill](../architecture/data-model.md)
- Workspace layout: [workspace-layout.md](../architecture/workspace-layout.md)
- Sidecar: [skills/store.ts](../../apps/desktop/sidecar/src/skills/store.ts), [methods/skills.{list,upsert,delete,generate,author}.ts](../../apps/desktop/sidecar/src/methods/)
- UI: [pages/skills/index.vue](../../apps/desktop/ui/pages/skills/index.vue), [components/skill/](../../apps/desktop/ui/components/skill/)
- External: [Claude Code SDK skills](https://docs.claude.com/claude-code/skills) · [craft-ai-agents/craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss)
- Related ADRs: [0001 — local-first storage](./0001-local-first-storage.md), [0008 — stdio IPC for sidecar](./0008-stdio-ipc-for-sidecar.md)
