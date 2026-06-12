# Feature: Project Templates

**Trạng thái:** v1 implemented (2026-06-12) — contract: [ADR 0036](../decisions/0036-project-templates.md) (nền: [ADR 0035](../decisions/0035-consolidate-config-tiers-to-awog.md))

## Overview

Template là **gói config tái dùng** (agents + skills + hooks + rules + commands) — một "bộ chuẩn" theo loại dự án. User **export** từ một project đã set up, rồi **install 1 nút** vào project mới. Tái dùng local, **không** marketplace.

## User Stories

- Là người dùng, tôi set up agents/skills/hooks/rules/commands cho 1 project rồi muốn lưu thành template để dự án sau dùng lại.
- Là người dùng tạo project mới, tôi muốn bấm "Install template" để có ngay bộ chuẩn, rồi tuỳ biến tiếp.
- Là người dùng, tôi muốn xem template có gì và sửa nhẹ (bật/tắt entity, đổi tên) trước khi cài.

## Functional Behavior

- **Tạo (`templates.create`):**
  - **Export-from-project:** chọn project → gom entity tier `project` (tuỳ chọn kèm `global`) → ghi bundle `~/.awog/templates/<id>/`.
  - **Sửa nhẹ** trong `/templates`: đổi name/description, bật/tắt từng entity trong bundle, thêm entity từ tier khác, xoá template.
  - *Không* soạn nội dung entity từ đầu (dùng trang Agents/Skills/… — [ADR 0036](../decisions/0036-project-templates.md) D-4).
- **List/Detail (`templates.list`/`templates.get`):** danh sách template + chi tiết (manifest + entity theo kind).
- **Install (`templates.install`):** chọn template + project đích + `conflictPolicy` → ghi vào tier `project` của đích qua `save*` (validate + atomic). Report `{ installed[], skipped[] }`.
  - Đường ghi: hooks/rules/commands → `{project}/.awog/{kind}/`; agents/skills → `{project}/.awog/agents|skills/`.
- **Conflict:** trùng id ở project đích → default **skip**, option **overwrite** ([ADR 0036](../decisions/0036-project-templates.md) D-6).
- **Delete (`templates.delete`):** xoá bundle `~/.awog/templates/<id>/`.

## Data Model

Bundle `~/.awog/templates/<id>/`:

```
template.json
agents/<id>.md
skills/<id>/SKILL.md
hooks/<id>.json
rules/<id>.md
commands/<id>.md
```

`template.json`:

```json
{
  "id": "web-app-team",
  "name": "Web app team",
  "description": "BA + dev + QA + reviewer, coding rules, commit hook",
  "createdAt": "2026-06-12T00:00:00.000Z",
  "sourceProjectId": "proj_abc",
  "entities": [
    { "kind": "agent", "id": "business-analyst", "file": "agents/business-analyst.md" },
    { "kind": "rule", "id": "code-style", "file": "rules/code-style.md" }
  ]
}
```

`source`/`projectId` của entity **không** ghi vào bundle — suy ra khi install ([ADR 0036](../decisions/0036-project-templates.md) D-2).

RPC: `templates.{list,get,create,install,delete}`. Store: [`stores/templates.ts`](../../apps/desktop/ui/stores/templates.ts).

## Security (theo [ADR 0036](../decisions/0036-project-templates.md) D-7 + [security.md](../../.claude/rules/security.md))

- Hook install → `trusted=false` (gate [ADR 0032](../decisions/0032-hook-execution-engine-ipc-contract.md) D-8).
- Template **không** chứa giá trị secret — chỉ ref `${secret:KEY}`; install xong nhắc user nhập keychain.
- Mọi write qua `assertInsideWorkspace`/`sanitizeChild`.

## UI/UX Notes

- **Trang `/templates`** (NavRail): master-detail — list template + search + New (export) + Refresh; detail = manifest + entity theo kind, nút Install (chọn project đích + conflict) / Edit / Delete.
- **Projects detail:** nút **Save as template** (export project đang chọn) + **Install template** (picker template → cài vào project này).
- Theme token qua `useTheme()`; i18n en/vi; tuân UI patterns ([nuxt-vue.md](../../.claude/rules/nuxt-vue.md)).

## Dependencies

- [ADR 0035](../decisions/0035-consolidate-config-tiers-to-awog.md) — **bắt buộc xong trước** (layout `.awog` đồng nhất).
- Store entity (`save*`) để install; `projects` store để chọn đích.

## Out of Scope (v1)

- **Marketplace / template remote / share link** — bundle tự chứa mở đường, chưa làm distribution ([mvp-scope](../requirements/mvp-scope.md)).
- **Kèm MCP/Connections** trong template ([ADR 0036](../decisions/0036-project-templates.md) D-3).
- **Export bundle ra file `.awogtemplate` (zip)** — defer.
- **Conflict merge/diff** — chỉ skip/overwrite.
- **Versioning template** — chưa.

## Open Questions

- Export có nên gồm cả global entity không, hay chỉ project? (v1: chọn được, default chỉ project.)
- Install có cho chọn subset entity của template, hay all-or-nothing? (v1 đề xuất: chọn được, mặc định all.)
