# Feature: Human Approval

**Trạng thái:** Approved — contract chốt tại [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md)

## Overview

Approval gate tạm dừng task tại một phase và yêu cầu người dùng review artifact trước khi workflow tiếp tục. Con người là *guild master* — luôn nắm quyền kiểm soát các checkpoint quan trọng.

## Hành động của người dùng tại một phase

- **Approve** — chỉ hiện khi phase đang `waiting_approval`. Chuyển phase sang `completed`, kích hoạt phase kế tiếp trong DAG.
- **Rerun from here** — invalidate phase này và toàn bộ downstream, modal hỏi instruction, tạo run mới v(n+1), version cũ thành `superseded`.
- **Discussion** (tab) — chat với agent ngay tại phase để thảo luận **mà không invalidate** workflow. Tin nhắn lưu vào `messages` của run hiện tại.

## Ví dụ luồng

```
Architecture v1 → tab Discussion
  User: "Single scheduler có thể fall behind?"
  Agent: "Good point, để rerun với partitioned design."
  ↓
User click Rerun from here, instruction: "Dùng 8 partitioned workers"
  ↓
v1 → superseded
v2 chạy với instruction trong context
  ↓
v2 status: waiting_approval → User Approve
  ↓
Phase chuyển completed, phase kế tiếp tự động bắt đầu
```

## Tính năng

- Approval gate có thể bật/tắt per node trong Workflow Builder (checkbox `approval`).
- Notification ([tray-and-notifications](../design/tray-and-notifications.md)) khi task vào `waiting_approval`.
- Sự kiện approval được ghi vào trace với `approvedBy` và `approvedAt`.
- Discussion lưu cùng run hiện tại — không tạo run mới.
- Rerun invalidate đệ quy: phase trigger + mọi phase downstream trong DAG.

## Auto-approve mode

- Settings có toggle `autoApprove`.
- Khi bật, approval gate được skip — workflow chạy liên tục.
- Dành cho dev / iterate nhanh; không khuyến nghị cho production task.

## Phụ thuộc

- [workflow-builder](./workflow-builder.md) — approval checkbox per node.
- [task-execution-engine](./task-execution-engine.md) — quản lý phase status và run.
- [artifact-system](./artifact-system.md) — artifact để review.
- [agent-trace](./agent-trace.md) — 3 tab Output/Execution/Discussion.

## Out of Scope (MVP)

- Multi-approver flow (any-of, all-of).
- Auto-approval timeout.
- Reject branch (chỉ có Rerun-from-here).
- Approve / Reject action button trực tiếp trong OS notification.

## Câu hỏi mở

- Có nên có "Comment-only" approval (approve nhưng kèm note bắt buộc đọc) không?
- Discussion message có nên tự động trigger rerun nếu user yêu cầu thay đổi, hay luôn cần Rerun-from-here thủ công?
