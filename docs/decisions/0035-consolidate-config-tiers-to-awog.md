# 0035 — Quy hoạch lại lưu trữ config-entity về `.awog` (single editable tier)

- **Trạng thái:** Accepted (2026-06-12)
- **Ngày:** 2026-06-12
- **Người quyết định:** Tech Lead (theo yêu cầu user)

## Bối cảnh

5 loại config-entity (agents, skills, hooks, rules, commands) hiện lưu trữ **không đồng nhất**:

- **Hooks / Rules / Commands** — editable 2-tier trên `.awog`: `global` `~/.awog/{kind}/` + `project` `{project}/.awog/{kind}/`; **cộng** các tier `claude-*` **read-only** đọc liên tục (`CLAUDE.md`, `.claude/rules`, `.claude/commands`, `.claude/settings.json` hooks array). Xem [ADR 0032](./0032-hook-execution-engine-ipc-contract.md), [ADR 0033](./0033-rules-system-prompt-injection.md), [ADR 0034](./0034-slash-commands-markdown.md).
- **Agents / Skills** — editable **5-tier** gồm cả `.claude`/`.agents`: `global` `~/.awog`, `user-claude` `~/.claude`, `user-agents` `~/.agents`, `project-claude` `{p}/.claude`, `project-agents` `{p}/.agents` — và **không có** tier `{project}/.awog/agents|skills`. Xem [ADR 0013](./0013-adopt-skill-md-format.md), [ADR 0015](./0015-agents-persisted-runtime-systemprompt.md).

Hệ quả: model "lẫn lộn" — agent/skill cấp project **bắt buộc** nằm trong `.claude`/`.agents`; mỗi loại có tập tier khác nhau (~95 chỗ so sánh literal `source`, ~56 path literal `.claude`/`.agents` trong sidecar). Khó nắm, và cản tính năng **Project Templates** ([ADR 0036](./0036-project-templates.md)) vì phải copy nhiều layout khác nhau.

User chốt hướng: **`.awog` là nhà duy nhất**, `.claude`/`.agents` hạ xuống **nguồn import một lần** (xem [feature config-import-assistant](../features/config-import-assistant.md)).

## Quyết định

| # | Vấn đề | Quyết định | Rationale |
|---|--------|------------|-----------|
| **D-1** | Editable storage | **Chỉ `.awog`, 2-tier, đồng nhất cả 5 loại:** `global` `~/.awog/{kind}/` + `project` `{project}/.awog/{kind}/`. Agent/Skill **thêm** tier project: `{project}/.awog/agents/<id>.md` (giữ layout single-file *hoặc* folder `<id>/AGENT.md`), `{project}/.awog/skills/<id>/SKILL.md`. | Một mô hình duy nhất cho mọi loại → dễ hiểu, dễ làm Template (chỉ copy `.awog/{kind}`). |
| **D-2** | `Source` union | Gộp về **`'global' \| 'project'`** cho **cả 5 loại**. Agent/SkillSource: 5 → 2 (bỏ `user-claude`/`user-agents`/`project-claude`/`project-agents`). Hook/Rule/CommandSource: bỏ các member `claude-*`. Sửa ở [`shared.ts`](../../apps/desktop/sidecar/src/types/shared.ts) + [`types/index.ts`](../../apps/desktop/ui/types/index.ts). | Một union 2 giá trị, không còn special-case `.claude`/`.agents`. |
| **D-3** | `.claude` / `.agents` | **Hạ xuống nguồn import-only.** Sidecar list functions **ngừng** scan/trả các tier ngoài `.awog`. **Không** còn đọc-live: `CLAUDE.md`, `.claude/rules`, `.claude/commands`, `.claude/settings.json` hooks, `.claude/agents`, `.agents/agents`, `.claude/skills`, `.agents/skills`. Truy cập duy nhất qua import assistant ([feature](../features/config-import-assistant.md)). | "`.awog` only" — đỡ phải cover nhiều loại. **Supersede** import-read-only của ADR 0032/0033/0034 + multi-tier của 0013/0015. |
| **D-4** | CLAUDE.md (rules) | **Import-only như mọi loại** — copy 1 lần vào `.awog/rules`, sau đó **hết auto-inject live**. (User đảo D-4/D-4b của [ADR 0033](./0033-rules-system-prompt-injection.md).) | User chọn đồng nhất tuyệt đối thay vì giữ interop sống với Claude Code. |
| **D-5** | Migration | **Copy, không move** — giữ nguyên `.claude`/`.agents` gốc. Import qua [config-import-assistant](../features/config-import-assistant.md). | Không phá config của Claude Code/Craft; an toàn, idempotent. |
| **D-6** | Runtime resolution | **Không đổi semantic.** Agent: `loadAgent(id, source, projectId)` explicit, fallback `loadAgentFlexibly` → id-match qua `listAgents`. Skill: `loadSkillByIdAnyTier` search theo list tier mới `[global, project]`. Chỉ sửa enum + thứ tự list, không sửa execution. | Khảo sát xác nhận runtime an toàn (xem [agent-context.ts](../../apps/desktop/sidecar/src/tasks/agent-context.ts), [skills/store.ts](../../apps/desktop/sidecar/src/skills/store.ts)). |
| **D-7** | Persisted ref cũ | **Tolerant đọc:** ref đã lưu với source cũ (`project-claude`…) → coi như **any-tier fallback** (id-match qua `listAgents`/`loadSkillByIdAnyTier`). `loadAgentFlexibly`: explicit load trả null → tiếp tục fallback (KHÔNG throw). | Workflow node / session cũ không vỡ; sau khi user import vào `.awog`, resolve khớp theo id. |
| **D-8** | fs-watcher | Watch **chỉ** `~/.awog/{kind}` + `{project}/.awog/{kind}`. Bỏ watch `.claude`/`.agents`. | Không còn tier ngoài `.awog` để theo dõi. |
| **D-9** | Default create | Giữ **`global`** khi tạo mới không chọn tier; `project` cần `projectId`. UI editor: scope selector rút còn **global / project** ở cả 5 `*Editor.vue`. | Đồng nhất với hooks/rules/commands hiện tại; UX không đổi. |
| **D-10** | Hook import trust | Hook import vào `.awog` project tier → **`trusted=false`** (trust gate [ADR 0032](./0032-hook-execution-engine-ipc-contract.md) D-8 nguyên vẹn); **không** copy secret (`${secret:KEY}` ref giữ nguyên, giá trị nằm ở keychain). | Bảo toàn invariant security; import không được leo thang quyền. |

## Phương án đã cân nhắc

- **Giữ `.claude` read-only liên tục (chỉ rules) + import 4 loại kia** — bị từ chối (D-4): user chọn đồng nhất tuyệt đối, chấp nhận mất live-inject CLAUDE.md.
- **Move thay vì copy khi import** — bị từ chối (D-5): xoá config của tool khác là phá hoại, vi phạm "look before delete".
- **Rewrite mọi persisted ref ngay khi migrate** — defer: tốn 1 lần scan + ghi; fallback id-match (D-7) đã đủ giải quyết, KISS hơn.
- **Giữ nguyên 5-tier cho agent/skill, chỉ thêm `.awog` project tier** — bị từ chối: vẫn "lẫn lộn", không đạt mục tiêu "only `.awog`".

## Hệ quả

- **Tích cực:** Một mô hình tier duy nhất cho 5 loại → giảm mạnh special-case; Template thành "copy thư mục `.awog/`". Project agent/skill cuối cùng cũng đi theo repo trong `.awog`. Runtime không đổi.
- **Tiêu cực / Trade-off:**
  - **Mất interop sống với Claude Code** — sửa `CLAUDE.md`/`.claude/agents` ngoài app không tự phản ánh; phải import lại (banner sẽ nhắc). Đây là đánh đổi user đã chấp nhận.
  - **Breaking với ref cũ** trỏ source `.claude`/`.agents`: dựa vào fallback D-7 + user import. Cần test kỹ workflow/session cũ.
  - Refactor chạm ~5 `store.ts` + 5 `*Editor.vue` + 2 type file + watcher; cần search-replace có kiểm soát + typecheck.
- **Việc cần làm tiếp:** triển khai [config-import-assistant](../features/config-import-assistant.md); cập nhật ADR 0013/0015/0032/0033/0034 (ghi "tier model superseded by 0035"); cập nhật feature docs skills/agents/hooks/rules/slash-commands; infosec review (copy filesystem + path sanitize + hook trust); QA regression workflow/session cũ.

## Tham chiếu

- Supersede (phần tier/import): [0013](./0013-adopt-skill-md-format.md), [0015](./0015-agents-persisted-runtime-systemprompt.md), [0032](./0032-hook-execution-engine-ipc-contract.md), [0033](./0033-rules-system-prompt-injection.md), [0034](./0034-slash-commands-markdown.md)
- Feature: [config-import-assistant](../features/config-import-assistant.md), [project-templates](../features/project-templates.md) ([ADR 0036](./0036-project-templates.md))
- Security: [`.claude/rules/security.md`](../../.claude/rules/security.md)
