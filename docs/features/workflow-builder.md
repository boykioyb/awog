# Feature: Workflow Builder

**Trạng thái:** Draft

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

## Tính năng

- DAG editor (không cycle).
- Gán agent + skill cho từng node.
- Mapping output → input qua edge.
- Approval gate per node.
- Versioning workflow (theo tên file: `name.json`, `name.v2.json`).
- Validation: input chưa nối, type mismatch, thiếu agent.

## Lưu trữ dữ liệu

`workspace/workflows/<workflow-name>.json` với lịch sử phiên bản tách riêng.

## Phụ thuộc

- [agent-builder](./agent-builder.md)
- [skill-builder](./skill-builder.md)
- [human-approval](./human-approval.md)

## Câu hỏi mở

- Có hỗ trợ nhánh song song và join không? (Workflow mẫu Backend Feature Pipeline đã thể hiện REV/QA parallel — cần xác định semantics chính thức.)
- Routing có điều kiện (if/else) biểu diễn thế nào?
- Skill input có nên validate type khi connect edge không?
