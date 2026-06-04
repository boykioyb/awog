# Feature: Workflow Builder

**Trạng thái:** Approved — contract chốt tại [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md)

## Overview

Workflow Builder là DAG designer kéo-thả cho phép người dùng lắp ráp pipeline đa agent một cách trực quan. Mỗi node trong DAG = một bước thực thi (agent + skill + output artifact + có/không approval gate).

## User Stories

- Là người dùng, tôi muốn dựng workflow đa agent một cách trực quan thay vì viết config.
- Là người dùng, tôi muốn drag một agent từ palette vào canvas để thêm node.
- Là người dùng, tôi muốn có approval gate để review artifact trung gian trước khi tiếp tục.

## Canvas

- Interface drag-drop với **dot pattern background**.
- **Drag agent từ palette vào canvas** tạo node mới tại vị trí thả.
- Mỗi node hiển thị: role badge + tên agent + skill + output artifact + approval icon nếu có.
- **Connection handle bên phải** node — drag sang node khác để tạo edge.
- Edge dạng bezier curve với arrow marker, click để xóa.
- **Connecting state**: dashed line preview khi đang kéo edge.

## Sidebar (panel trái)

- **Workflow list** (nửa trên) — switch giữa nhiều workflow, tạo workflow mới với inline input (Enter để save, Esc để hủy).
- **Agent palette** (nửa dưới) — kéo vào canvas để thêm node.

## Inspector (panel phải)

Hiện khi chọn node, gồm:

- **Skill selector** — chỉ list skills mà agent đó có.
- **Output artifacts** — list editable, thêm/xóa từng item.
- **Approval checkbox** — bật/tắt gate sau node.
- **Skill inputs (auto-resolved)** — read-only display, suy ra từ edge upstream.

## Ví dụ workflow mẫu

- **Backend Feature Pipeline** (5 nodes): BA → SA → DEV → REV/QA (REV và QA chạy parallel sau DEV)
- **Quick Bug Fix** (3 nodes): DEV → REV → QA

## Tạo bằng prompt (LLM)

Nút "+ New" mở `WorkflowPromptCreator`: user mô tả workflow bằng ngôn ngữ tự nhiên → gọi `workflows.generate` (claude-agent-sdk one-shot). LLM được cấp **danh sách agent khả dụng** (đã lọc theo scope "Save to") và sinh DAG thật: mỗi node chọn `agentId` + `skillId` (từ skill của agent đó) + outputs + approval, kèm edges. UI resolve `agentSource`/`projectId` + tự layout x/y (layered theo rank). Không có sidecar/account → fallback mock chỉ tạo name/description (DAG rỗng), kéo agent thủ công sau.

## Tính năng

- DAG editor (không cycle).
- Gán agent + skill cho từng node.
- Mapping output → input qua edge.
- Approval gate per node.
- Versioning workflow (theo tên file: `name.json`, `name.v2.json`).
- Validation: input chưa nối, type mismatch, thiếu agent.

## Lưu trữ dữ liệu

2 tier (như Skills/Agents — [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md) D-3):

- **Global (dùng chung):** `~/.awog/workflows/<id>.json` — tái dùng cho mọi project.
- **Project (đi theo repo):** `{project.path}/.awog/workflows/<id>.json` — git-track, share với team.

`source`/`projectId` suy ra từ vị trí file (không lưu trong JSON, vì project id là machine-specific). Trang `/workflows` có scope selector lọc + chọn nơi lưu workflow mới; `NewTaskModal` chỉ hiện workflow global + của project đang chọn.

## Phụ thuộc

- [agent-builder](./agent-builder.md)
- [skill-builder](./skill-builder.md)
- [human-approval](./human-approval.md)

## Nhánh song song & agent identity (chốt ADR 0024)

- **Parallel + join**: node chạy khi *mọi* upstream `completed`; nhánh độc lập chạy đồng thời (D-1). Node ghi-code nên nối tuần tự (D-9).
- **Agent identity trên node**: `WorkflowNode` mang `agentId` + `agentSource` + `agentProjectId?` (đủ tuple cho `loadAgent`) — D-11.

## Câu hỏi mở

- Routing có điều kiện (if/else) biểu diễn thế nào? (sau MVP)
- Skill input có nên validate type khi connect edge không? (sau MVP)
