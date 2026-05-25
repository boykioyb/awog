# Feature: Skill Builder

**Trạng thái:** Draft

## Overview

Skill là năng lực tái sử dụng được mà agent có thể thực hiện. Mỗi skill có category, input/output xác định, prompt template và tags. Skill tách rời *agent có thể làm gì* khỏi *agent nào làm việc đó*.

## User Stories

- Là người dùng, tôi muốn định nghĩa skill `design_architecture` một lần và tái sử dụng cho nhiều architect agent.
- Là người dùng, tôi muốn lọc skill theo category để tìm nhanh.
- Là người dùng, tôi muốn thấy skill được dùng bởi agent nào.

## Skill list view

- Search box, **category filter** (Analysis / Design / Development / Quality).
- Item: tên (mono font) + category + agent count.

## Skill detail view

- Name (mono) + category badge + description.
- Edit / Delete button.
- **Inputs & Outputs** (2 card riêng).
- **Prompt template** (code block với placeholders).
- **Tags** (`#planning`, `#code`, …).
- **"Used by"** section — list agent đang dùng skill này.

## Skill editor

- **Name** (auto snake_case khi nhập).
- **Category** dropdown.
- **Description**.
- **Inputs / Outputs** list (add/remove từng item).
- **Prompt template** textarea.
- **Tags** với Enter-to-add.

## Thuộc tính Skill

| Field | Kiểu | Mô tả |
|---|---|---|
| `id` | string | Slug duy nhất |
| `name` | string | snake_case, ví dụ `design_architecture` |
| `category` | enum | Analysis / Design / Development / Quality |
| `description` | string | Skill làm gì |
| `inputs` | string[] | Tên artifact đầu vào, ví dụ `["requirement.md", "existing_codebase"]` |
| `outputs` | string[] | Tên artifact đầu ra, ví dụ `["architecture.md", "component_diagram.mmd"]` |
| `promptTemplate` | string | Template tham chiếu input |
| `tags` | string[] | Free-form tag |

## Skill mẫu (12 skill mặc định)

**Analysis:**
- `gather_requirements`
- `write_user_stories`

**Design:**
- `design_architecture`
- `design_api`

**Development:**
- `implement_feature`
- `refactor_code`
- `fix_bug`

**Quality:**
- `review_code`
- `security_audit`
- `write_tests`
- `run_qa`
- `regression_check`

## Lưu trữ dữ liệu

`workspace/skills/<skill-name>.json`.

## Phụ thuộc

- [artifact-system](./artifact-system.md) — skill consume/produce artifact.
- [agent-builder](./agent-builder.md) — agent gán skill.

## Câu hỏi mở

- Có hỗ trợ composition (skill gọi skill) không?
- Validate input/output type ở giai đoạn thiết kế workflow thế nào?
- Khi rename skill, các agent/workflow đang tham chiếu cập nhật tự động không?
