# Feature: Task Execution Engine

**Trạng thái:** Approved — contract chốt tại [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md)

## Overview

Execution engine chạy workflow dưới dạng task. Một Task là instance của Workflow gắn với một Project. Engine quản lý từng **Phase** (instance của một Node trong context Task), mỗi Phase có lịch sử **Run** với versioning.

## User Stories

- Là người dùng, tôi muốn task gắn với project cụ thể để biết codebase nào đang được làm.
- Là người dùng, tôi muốn rerun từ một phase ở giữa workflow khi không hài lòng output, không phải chạy lại từ đầu.
- Là người dùng, tôi muốn thấy lịch sử v1, v2, v3 của một phase và switch giữa các phiên bản.
- Là người dùng, tôi muốn task chạy nền khi tôi đóng cửa sổ.

## Nguồn Task

- **GitHub Issue URL** — auto-parse repo + issue number.
- **Jira Ticket Key** — ví dụ `AUTH-512`.
- **Manual** — title + description nhập tay.

## Mô hình thực thi

```
Task (gắn Project) → Workflow → Phase (per Node) → Run (per execution)
                                    │
                                    ├── Output (artifact)
                                    ├── Trace tree
                                    └── Messages (discussion)
```

## Trạng thái Task

`queued` → `running` → `waiting_approval` → `completed` / `failed`

## Trạng thái Phase

- `pending` — chưa tới lượt
- `running` — đang thực thi
- `waiting_approval` — đang chờ con người duyệt
- `completed` — đã xong và được duyệt (nếu có gate)
- `failed`

## Trạng thái Run

- `running`, `waiting_approval`, `completed`, `failed` — như Phase.
- `superseded` — bị thay thế bởi run mới hơn (do rerun-from-here).

## Run versioning

Mỗi lần Phase được thực thi tạo ra một Run mới với `version` tăng dần (1, 2, 3, …).

- Run đầu tiên = v1.
- Khi user trigger **Rerun from here**:
  1. Run hiện tại của phase đó (và mọi run `completed` của phase) đánh dấu `superseded`.
  2. Mọi phase **downstream** trong DAG được đánh dấu `superseded` toàn bộ run, đưa về `pending`.
  3. Tạo run mới v(n+1) cho phase trigger, status `running`.
  4. Modal hỏi user "instruction cho rerun" — instruction được ghi vào `messages` của run mới làm context.

## Group & Filter Task

- **4 group mode**: Project (mặc định), Status, Workflow, Flat.
- **Filter độc lập**: project filter + status filter (All / Running / Approval / Queued / Completed).
- **Search**: theo title hoặc task ID.
- **Group header sticky, collapsible, có count**.

## Task list item

Tối giản: status icon + title + một dòng meta context-aware:
- Group by Project → hiện workflow.
- Group by khác → hiện project.
- Progress bar chỉ hiện khi `running` hoặc `waiting_approval`.

## Task detail

- **Header**: ID, status pill, title, project info (name + path), source link, workflow name, description.
- **Pipeline timeline**: danh sách phase, mỗi phase là một collapsible card.

## Tính năng

- Thực thi async; UI vẫn phản hồi.
- Trạng thái persistent — task sống sót qua restart và qua đóng cửa sổ (engine chạy ở tray).
- Ghi nhận trace event cho từng bước.
- Approve / Rerun-from-here / Discussion ngay tại phase.

## Lưu trữ dữ liệu

`workspace/tasks/<task-id>/` gồm `task.json` (status, phases với runs), `events.log`, `artifacts/`.

## Phụ thuộc

- [projects](./projects.md) — task bắt buộc gắn project
- [workflow-builder](./workflow-builder.md)
- [agent-builder](./agent-builder.md)
- [artifact-system](./artifact-system.md)
- [human-approval](./human-approval.md)
- [agent-trace](./agent-trace.md)

## Câu hỏi mở (đã chốt qua ADR 0024)

- ~~Concurrency~~ → **Parallel scheduler**, cap 4 node/task đồng thời; nhiều task chạy song song (ADR 0024 D-1).
- ~~Retry khi agent lỗi~~ → **Không auto-retry** (MVP); node fail kéo downstream fail; user rerun thủ công.
- ~~Artifact downstream khi rerun~~ → **Giữ trong Git history** (project repo); run cũ đánh `superseded`, không archive riêng.
