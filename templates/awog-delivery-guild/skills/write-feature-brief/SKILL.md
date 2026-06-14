---
name: write-feature-brief
description: Create a 1-page Feature Brief for AWOG capturing problem, target user, why-now, success criteria, and fit-with-vision. Use this when the Product Owner needs to document a feature idea before handing it to BA for detailed spec.
---

# Skill: Write Feature Brief

Tạo **Feature Brief** ngắn (~1 trang) cho ý tưởng feature mới. Đầu ra để PO duyệt hoặc BA mở rộng.

## Khi nào dùng

- Có ý tưởng feature mới, chưa biết có nên làm không.
- PO cần document ý tưởng trước khi giao BA.
- Cần so sánh nhiều ý tưởng để ưu tiên.

## Khi nào KHÔNG dùng

- Đã có ý tưởng rõ → đi thẳng vào spec (gọi BA + skill `elicit-requirements`).
- Bug fix / refactor / chore — không cần brief.

## Template

Lưu ở `docs/features/<feature-slug>.md`:

```markdown
# Feature Brief: <Tên feature>

> **Status:** Draft | In Spec | In Dev | Done | Rejected
> **Owner:** <PO name / placeholder>
> **Created:** YYYY-MM-DD

## Problem

<1-2 đoạn — vấn đề thực user đang gặp. Không bắt đầu bằng giải pháp.>

## Target user

- **Persona:** <ai cụ thể, không phải "mọi user">
- **Tần suất gặp problem:** <hằng ngày | tuần | hiếm>
- **Workaround hiện tại:** <họ đang làm gì để né problem>

## Why now

<Lý do bây giờ phải làm. Có thể là: dependency đã sẵn sàng, user yêu cầu nhiều, block roadmap khác, etc.>

## Hypothesis

<Niềm tin: nếu ta làm X, thì Y sẽ xảy ra. Đo bằng Z.>

## Success criteria

<Cách biết feature thành công. Đo được, không mơ hồ.>
- ...
- ...

## Fit with vision

| Tiêu chí | Đánh giá |
|---|---|
| Artifact-driven | <Yes/No + 1 dòng> |
| Workflow-based | ... |
| Human-in-the-loop | ... |
| Local-first | ... |

## Scope hint

- **In MVP** | **v-next** | **Backlog**
- Layer chạm: UI / Sidecar / Storage / Model adapter / ...
- Ước lượng độ lớn (PM sẽ refine): S / M / L / XL

## Out of scope (cho lần này)

- ...

## Open questions cho user

- ...

## Liên kết

- [VISION](../../artifacts/VISION.md)
- [MVP scope](../requirements/mvp-scope.md)
- Brief khác liên quan: ...
```

## Quy tắc viết

- **Problem trước solution.** Đừng nhảy thẳng vào "tôi nghĩ ta nên thêm nút X".
- **Concrete user.** "Người dùng" mơ hồ → vô dụng. Phải có persona.
- **Đo được.** Success criteria phải đếm được hoặc check được, không "user thấy dễ hơn".
- **Không spec.** Brief KHÔNG chứa UI mockup, API contract, data shape. Đó là việc của BA.
- **Một trang.** Nếu dài hơn → đang viết spec, dừng lại.

## Liên kết với role khác

- **Sau khi xong:** PO duyệt → giao BA viết spec chi tiết → file `docs/features/<feature>-spec.md` hoặc mở rộng file brief.
- **Reject:** ghi `Status: Rejected` + lý do, không xóa file (giữ context cho lần sau).
