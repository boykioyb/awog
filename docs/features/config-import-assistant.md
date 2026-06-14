# Feature: Config Import Assistant (`.claude`/`.agents` → `.awog`)

**Trạng thái:** v1 implemented (2026-06-12) — contract: [ADR 0035](../decisions/0035-consolidate-config-tiers-to-awog.md)

## Overview

Sau khi gộp mọi config-entity về `.awog` ([ADR 0035](../decisions/0035-consolidate-config-tiers-to-awog.md)), `.claude`/`.agents` không còn là tier sống mà là **nguồn import một lần**. Import Assistant **phát hiện** config nằm ngoài `.awog` (trong `.claude`, `.agents`, `CLAUDE.md`, `.claude/settings.json`…) và **gợi ý copy** chúng vào `.awog` để AWOG quản lý duy nhất.

## User Stories

- Là người dùng đã có agents/skills trong `.claude`, tôi muốn 1 nút kéo hết sang `.awog` thay vì tạo lại tay.
- Là người dùng mở project lần đầu trong AWOG, tôi muốn được nhắc nếu repo có sẵn `.claude`/`.agents` để import.
- Là người dùng, tôi muốn xem trước item nào sẽ import (loại + id + nguồn) và chọn từng cái, không import mù.

## Functional Behavior

- **Phát hiện (`migration.scan`):** scope **loại trừ** — có `projectId` thì **chỉ** quét nguồn của project đó (`{p}/.claude`, `{p}/.agents`, `{p}/CLAUDE.md`…); không có `projectId` thì **chỉ** quét global (`~/.claude`/`~/.agents`). Trả danh sách item importable theo từng loại — bỏ qua item đã tồn tại cùng id trong `.awog` tier tương ứng. Banner trong Project vì vậy không lẫn config global; global import nằm ở entry riêng (Settings → Workspace).
  - Nguồn quét (tái dùng helper sẵn có — [ADR 0035](../decisions/0035-consolidate-config-tiers-to-awog.md)):
    | Loại | Nguồn project | Nguồn global |
    |---|---|---|
    | Agents | `{p}/.claude/agents`, `{p}/.agents/agents` | `~/.claude/agents`, `~/.agents/agents` |
    | Skills | `{p}/.claude/skills`, `{p}/.agents/skills` | `~/.claude/skills`, `~/.agents/skills` |
    | Hooks | `{p}/.claude/settings.json`, `settings.local.json` | `~/.claude/settings.json` |
    | Rules | `{p}/CLAUDE.md`, `{p}/.claude/rules/*.md` | `~/.claude/CLAUDE.md` |
    | Commands | `{p}/.claude/commands/**` | `~/.claude/commands/**` |
- **Banner tự phát hiện:** trong Projects detail, khi project có item importable (chưa import) → banner "Phát hiện N config ở `.claude`/`.agents` — Import vào `.awog`?". Dismiss được; vẫn còn **nút Import thủ công** bấm lại bất cứ lúc nào (cả global lẫn project).
- **Preview + chọn:** dialog liệt kê item theo loại (kind · id · nguồn), checkbox chọn từng cái / chọn tất cả; mặc định chọn item chưa trùng id.
- **Import (`migration.import`):** **copy** (không move — [ADR 0035](../decisions/0035-consolidate-config-tiers-to-awog.md) D-5) item đã chọn vào `.awog` tier tương ứng (`global` hoặc `project`) qua `save*` của từng store. Trả report `{ imported[], skipped[] }`.
- **Sau import:** UI re-hydrate list loại liên quan; banner ẩn khi không còn item importable.

## Security (theo [ADR 0035](../decisions/0035-consolidate-config-tiers-to-awog.md) + [security.md](../../.claude/rules/security.md))

- **Hook** import → `trusted=false` (gate [ADR 0032](../decisions/0032-hook-execution-engine-ipc-contract.md) D-8); user duyệt trước khi dispatch.
- **Secret không copy:** ref `${secret:KEY}` giữ nguyên text; giá trị ở keychain, user tự nhập sau.
- **Path:** mọi write qua `assertInsideWorkspace`/`sanitizeChild`; project scope = workspace.
- **Non-destructive:** nguồn `.claude`/`.agents` giữ nguyên; import idempotent (re-scan bỏ qua item đã có).

## Data Model (as implemented)

`migration.scan({ projectId? })` → `{ candidates: ImportCandidate[] }` với
`ImportCandidate = { kind, id, name, fromLabel, targetScope: 'global'|'project', projectId?, alreadyExists }`.

`migration.import({ projectId?, items: { kind, id, targetScope, projectId? }[] })` →
`{ result: { imported: {kind,id}[], skipped: {kind,id,reason}[] } }`.

Types ở [`shared.ts`](../../apps/desktop/sidecar/src/types/shared.ts) + [`types/index.ts`](../../apps/desktop/ui/types/index.ts). Logic: [`migration/migrate.ts`](../../apps/desktop/sidecar/src/migration/migrate.ts).

## UI/UX Notes

- **Banner:** trong [pages/projects/index.vue](../../apps/desktop/ui/pages/projects/index.vue) detail pane; dùng theme token; i18n en/vi.
- **Import dialog:** master list theo kind, count chip `(N)` per kind, checkbox; nút "Import N item".
- **Global import:** entry trong Settings → Workspace (hoặc nút trên trang mỗi loại) để quét `~/.claude`/`~/.agents`.

## Dependencies

- [ADR 0035](../decisions/0035-consolidate-config-tiers-to-awog.md) — tier consolidation (làm cùng pha).
- Store sẵn có: `agents`/`skills`/`hooks`/`rules`/`commands` (`save*` + scan helper).

## Out of Scope (v1)

- **Move** (xoá nguồn sau import) — chỉ copy.
- **Live-sync** `.claude` ↔ `.awog` — import là one-shot, không theo dõi tiếp.
- **Resolve `@import` directive** của CLAUDE.md — body copy nguyên văn.
- **Conflict merge/diff** — item trùng id mặc định bỏ qua (skip).

## Open Questions

- Có cần auto-scan global (`~/.claude`) khi khởi động app, hay chỉ khi user bấm?
- Khi import CLAUDE.md (1 file dài) → 1 rule hay tách theo heading? (v1: 1 rule/file.)
