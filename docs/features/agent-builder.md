# Feature: Agent Builder

**Trạng thái:** Draft

## Overview

Agent Builder cho phép người dùng tạo và cấu hình các AI agent tùy biến. Một agent là một worker có tên, gắn với vai trò cụ thể, có model, system prompt, và tập skill cùng context provider mà nó được phép dùng.

## User Stories

- Là người dùng, tôi muốn tạo một agent *Business Analyst* để nó gather requirement.
- Là người dùng, tôi muốn gán skill cụ thể cho một agent để nó chỉ làm những gì tôi cho phép.
- Là người dùng, tôi muốn chọn model cho từng agent để cân bằng chi phí và chất lượng.

## Agent list view

- Search box, "+ New" button.
- Item: role badge + tên + model + skill count.
- **Badge column tự có width đồng nhất** dựa trên role dài nhất, tránh thò thụt.

## Agent detail view

- Role badge to (48px, tự co theo độ dài role).
- Tên + model + vendor + agent ID.
- 3 action: **Duplicate**, **Edit**, **Delete** (với confirmation).
- System prompt.
- Skills nhóm theo category (Analysis / Design / Development / Quality).
- Context providers dạng pill.

## Agent editor

- **Name** + **Role tag** (không giới hạn ký tự — hỗ trợ "DevOps", "Security Specialist", "Marketing", …).
- **Model picker**: grid 2 cột radio-style với 12 model thật:
  - Claude Opus 4.7, Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5
  - GPT-5, GPT-5 mini, o3, Codex 1
  - Gemini 2.5 Pro, Gemini 2.5 Flash
  - Llama 3.3 70B, Qwen 3 Coder 32B
- **System prompt textarea**.
- **Skills picker** với search, nhóm theo category, checkbox.
- **Context providers** toggleable pill.

## Thuộc tính Agent

| Field | Kiểu | Mô tả |
|---|---|---|
| `id` | string | Slug duy nhất |
| `name` | string | Tên hiển thị, ví dụ *Solution Architect* |
| `role` | string | Tag ngắn: BA / SA / DEV / REVIEW / QA / DevOps / Security |
| `model` | enum | ID model (xem list ở trên) |
| `systemPrompt` | string | System prompt |
| `skillIds` | string[] | Tham chiếu tới skill |
| `context` | string[] | Whitelist provider: artifacts, gitnexus, filesystem, notion, jira, slack |

## Agent mẫu

7 agent mặc định khi khởi tạo workspace:
- Business Analyst (BA)
- Solution Architect (SA)
- Senior Developer (DEV)
- Code Reviewer (REVIEW)
- QA Engineer (QA)
- DevOps Engineer (DevOps)
- Security Specialist (Security)

## Lưu trữ dữ liệu

`workspace/agents/<agent-slug>.json`.

## Phụ thuộc

- [skill-builder](./skill-builder.md) — cung cấp skill có thể chọn.
- [context-providers](./context-providers.md) — provider có thể whitelist.
- [settings](./settings.md) — model API key.

## Câu hỏi mở

- Agent có nên hỗ trợ inheritance / templating không?
- API key của model cấu hình per-agent hay global (hiện global trong Settings)?
- Khi xóa skill, agent đang dùng skill đó xử lý thế nào?
