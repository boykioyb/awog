---
name: write-adr
description: Author an Architecture Decision Record (ADR) for AWOG with Context, Decision, Consequences. Used by Tech Lead when a non-trivial technical choice is made — new dependency, IPC/data shape change, runtime model shift.
---

# Skill: Write ADR

Ghi lại **một** quyết định kiến trúc dưới dạng ADR (immutable, append-only).

## Khi nào dùng

- Chọn dependency lớn (UI lib, runtime, storage backend).
- Đổi IPC protocol / event schema / data shape entity.
- Đổi luồng async / approval / persistence.
- Bất kỳ change phá giả định core: local-first, no-DB, no-cloud, two-process.

## Khi nào KHÔNG cần ADR

- Refactor nội bộ một file.
- Bug fix.
- Format / rename / lint.
- Đã có ADR cũ phủ chủ đề.

## Template

Lưu ở `docs/decisions/NNNN-<slug>.md`. **Số tăng dần**, không reuse, không sửa ADR đã accepted (chỉ tạo ADR mới `Supersedes NNNN`).

```markdown
# NNNN — <Tên quyết định ngắn, imperative>

> **Status:** Proposed | Accepted | Superseded by NNNN | Deprecated
> **Date:** YYYY-MM-DD
> **Decision-makers:** <tên hoặc role>
> **Supersedes:** <NNNN khác, nếu có>

## Context

<Bối cảnh dẫn tới quyết định. Vấn đề là gì? Áp lực gì? Ràng buộc gì?
Liên kết tới feature spec, ADR liên quan, requirement.>

## Options considered

### Option A — <tên>

- **Mô tả:** ...
- **Pros:** ...
- **Cons:** ...

### Option B — <tên>

- **Mô tả:** ...
- **Pros:** ...
- **Cons:** ...

### Option C — <tên>

- **Mô tả:** ...
- **Pros:** ...
- **Cons:** ...

## Decision

**Chọn: Option <X>.**

<1-2 đoạn lý do — vì sao thắng so với những option khác. Ưu tiên triết lý core nào?>

## Consequences

### Positive

- ...

### Negative / cost

- ...

### Knock-on

- File nào phải cập nhật?
- ADR/spec nào phải refresh?
- Migration cần gì? (one-time script, manual, etc.)
- Ai chịu ảnh hưởng (UI dev, sidecar dev, user)?

## Implementation pointers

- Module/file dự kiến chạm: ...
- Test bổ sung: ...
- Rollout: dùng feature flag, big-bang, hay incremental?

## Reversibility

- **Reversible:** dễ / khó / 1-way door.
- Nếu khó: bao lâu để rollback, mất gì khi rollback.

## Liên kết

- Spec liên quan: ...
- ADR liên quan: ...
- External reference: ...
```

## Quy tắc viết

- **One decision per ADR.** Không bundle.
- **Imperative title.** "Sử dụng Tauri cho desktop shell" thay vì "Bàn về Tauri".
- **Options đối xứng.** Mỗi option có cùng cấu trúc pros/cons. Đừng strawman.
- **Decision không phải kết luận mơ hồ.** Phải chọn 1 option và viết "Chọn: X".
- **Consequences đầy đủ.** Không chỉ pros; phải gọi tên cost.
- **Immutable sau Accepted.** Đổi ý → ADR mới supersede ADR cũ.

## Kiểm tra trước khi commit ADR

- [ ] Số ADR đúng next (xem `docs/decisions/` rồi +1).
- [ ] Slug kebab-case khớp title.
- [ ] Status đúng: Proposed (khi PR), Accepted (khi merge).
- [ ] Pros/cons mỗi option ≥ 2 mục.
- [ ] Decision có 1 đoạn lý do.
- [ ] Consequences có positive **và** negative.
- [ ] Liên kết tới spec/ADR khác bằng relative path.

## ADR có sẵn để tham chiếu

Đọc `docs/decisions/0001-*.md` đến file mới nhất trước khi viết — để giữ giọng văn nhất quán.

## Liên kết với role khác

- **Trước:** TL nhận task ADR từ PM (skill `decompose-tasks`).
- **Sau:** developer implement theo ADR (skill `implement-feature`).
