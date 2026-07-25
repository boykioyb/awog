---
name: elicit-requirements
description: Turn a Feature Brief into a detailed Feature Spec with user flows, acceptance criteria (Given/When/Then), edge cases, dependencies, and open questions. Used by Business Analyst on AWOG.
---

# Skill: Elicit Requirements

Mở rộng **Feature Brief** thành **Feature Spec** đầy đủ để dev có thể implement và QA có thể test.

## Khi nào dùng

- Đã có Brief từ PO, cần spec chi tiết.
- Feature đã code nhưng thiếu document — backfill spec.

## Template

Lưu ở `docs/features/<feature-slug>.md` (mở rộng Brief, hoặc tạo file `<feature>-spec.md`):

```markdown
# Feature Spec: <Tên>

> **Brief:** [link]
> **Status:** Draft | Review | Approved | In Dev | Done
> **Last updated:** YYYY-MM-DD

## Tóm tắt

<1 đoạn — feature này cho phép user làm gì.>

## User flow

### Flow chính (golden path)

1. User ở <screen> ...
2. Click <element> → ...
3. Hệ thống ... → kết quả ...

### Flow phụ

- <ngắn gọn, hoặc link tới flow chính sang nhánh khác>

## Acceptance criteria

Viết theo **Given / When / Then**:

- **AC1.** Given <state>, when <action>, then <observable result>.
- **AC2.** ...
- **AC3.** ...

Mỗi AC phải:
- Quan sát được (không "feel smooth").
- Có một và chỉ một hành vi.
- Đặt số ID để PM/QA tham chiếu.

## UI behavior

- **Component liên quan:** <list, ref [apps/desktop/ui-next/components/](../../apps/desktop/ui-next/components/)>
- **Route mới (nếu có):** ...
- **State mới ở store:** ... (ref [stores/](../../apps/desktop/ui-next/stores/) — tách theo domain: agents/skills/projects/tasks/workflows/sessions/…)
- **Theme token mới (nếu có):** ...
- **Empty/loading/error state:** mô tả từng cái.

## Data shape

- **Entity mới/đổi:** ref [types/index.ts](../../apps/desktop/ui-next/types/index.ts)
- **File trên đĩa thay đổi:** path + format
- **Event log thêm:** type + payload

## Edge case

Phủ tối thiểu:
- Input rỗng / max length / special char / Unicode.
- Network offline (local-first, có thể chạy không).
- Concurrent action (2 task chạy song song chạm cùng artifact).
- App restart giữa chừng (resume đúng?).
- File lock / permission denied khi ghi.
- Approval gate: user không bao giờ approve (timeout?).

## Dependencies

- **Entity hiện có liên quan:** Task / Project / Workflow / Agent / Skill / Artifact / ...
- **Feature khác phụ thuộc/bị phụ thuộc:** ...
- **ADR ảnh hưởng:** ...
- **External:** API model, Git CLI, OS notification, ...

## Non-functional

| Tiêu chí | Mục tiêu |
|---|---|
| Latency UI | ... |
| Offline | có / không |
| Restart-safe | có / không |
| Storage size | ... |

## Out of scope

- ...

## Open questions

Đánh dấu rõ, **không tự bịa**:

- **Q1.** ... → cần PO/user trả lời.
- **Q2.** ... → cần tech-lead quyết.

## Liên kết

- Brief: ...
- ADR liên quan: ...
- Architecture: [system-overview](../architecture/system-overview.md), [data-model](../architecture/data-model.md), [execution-model](../architecture/execution-model.md)
```

## Quy tắc viết AC

- **Mỗi AC = 1 hành vi.** "User click X và thấy Y và Z saved" → tách thành 2 AC.
- **Đo được**: "danh sách hiển thị 10 item" thay vì "danh sách hiển thị".
- **Không nội bộ**: AC mô tả hành vi user quan sát, không mô tả internal state (đó là design).

## Edge case sót hay gặp ở AWOG

- File workspace bị xóa thủ công khi app đang chạy.
- Git repo trong workspace bị conflict do user thao tác ngoài app.
- API key invalid khi model call.
- Tray icon bị system kill.
- Two windows mở cùng workspace.

## Liên kết với role khác

- **Trước:** PO viết Brief (skill `write-feature-brief`).
- **Sau:** PM chia task (skill `decompose-tasks`) → TL quyết approach (skill `write-adr` nếu cần) → developer implement.
