---
name: decompose-tasks
description: Break a Feature Spec into ordered, sized, owner-assigned engineering tasks with dependencies and acceptance per task. Outputs a plan checklist used by Project Manager on AWOG.
---

# Skill: Decompose Tasks

Chuyển **Feature Spec** thành **Task Plan** thực thi được.

## Khi nào dùng

- Spec đã approve, cần chia việc.
- Cần ước lượng / sắp ưu tiên cho sprint.

## Template

Lưu ở `docs/features/<feature-slug>-plan.md`:

```markdown
# Plan: <feature>

> **Spec:** [<feature>.md](./<feature>.md)
> **Target milestone:** MVP | v-next | Backlog
> **Last updated:** YYYY-MM-DD

## DAG (high level)

```
T1 (TL: ADR) → T2 (dev: types) → T3 (dev: store) → T4 (dev: UI) → T6 (QA)
                                 ↘ T5 (dev: composable) ↗
```

## MVP scope

### T1. Quyết định approach <X>
- **Size:** S
- **Role:** tech-lead
- **Depends on:** none
- **Acceptance:** ADR ở `docs/decisions/NNNN-<slug>.md`, được PO/TL duyệt.
- **Risk:** —

### T2. Thêm entity `<Name>` vào types
- **Size:** S
- **Role:** developer
- **Depends on:** T1
- **Acceptance:**
  - `apps/desktop/ui/types/index.ts` cập nhật.
  - `pnpm typecheck` pass.
- **Risk:** —

### T3. ...

## Backlog (sau MVP)

### T9. ...
- **Size:** ...
- **Role:** ...
- **Acceptance:** ...

## Test plan high-level

- TC theo AC1, AC2, ... của spec.
- Edge case ưu tiên cao: <liệt kê 2-3>.

## Risks

- ...

## Open questions

- ...
```

## Cách chia task

### Tách theo layer

| Layer | Ví dụ task |
|---|---|
| ADR | "Quyết định IPC payload shape" |
| Types | "Thêm type Artifact với 3 field" |
| Store | "Thêm action runTask vào workspace store" |
| Composable | "Tạo `useArtifactDraft()`" |
| Util | "Hàm `serializeArtifact()`" |
| UI component | "Component `ArtifactCard.vue`" |
| Route/page | "Trang `/artifacts/:id`" |
| Sidecar (sau MVP) | "Endpoint POST `/run`" |
| Tài liệu | "Cập nhật README, ADR index" |
| Test | "Test case cho ArtifactCard" |

### Sizing

- **S** (< 0.5 ngày) — 1 hàm, 1 component nhỏ, 1 ADR.
- **M** (0.5–2 ngày) — 1 page với store + composable.
- **L** (2–5 ngày) — flow nhiều màn, nhiều entity.
- **XL** (> 5 ngày) — **bắt buộc tách**.

### Dependency

- Vẽ DAG ngắn (ASCII OK).
- Task song song được → mark độc lập, không serial hóa thủ công.
- Critical path → đánh dấu rõ.

### Đặt acceptance per task

Mỗi task có ≥ 1 cách check done:
- File X cập nhật + lint pass.
- Test case Y pass.
- ADR Z merged.
- UI feature visible ở route W.

## Anti-pattern

- ❌ "Implement feature X" — quá to.
- ❌ "Implement + test + document" — gộp nhiều mục đích.
- ❌ "Refactor toàn bộ store" — không scope rõ.
- ❌ Không acceptance — không biết khi nào done.
- ❌ Bỏ qua task ADR — quyết định kiến trúc lẫn vào task code.

## Quy tắc AWOG

- **MVP-first**: task ngoài MVP scope phải ở section "Backlog".
- **Tài liệu là task riêng** — README, ADR, spec update không nhồi vào code task.
- **Test là task riêng**.
- **Migration / dependency add** → flag rõ, có thể cần ADR trước.

## Liên kết với role khác

- **Trước:** BA hoàn tất Spec (skill `elicit-requirements`).
- **Sau:** TL nhận task ADR (skill `write-adr`) → developer nhận task implement (skill `implement-feature`) → QA nhận test (skill `write-test-cases`).
