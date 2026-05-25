# Feature: Slash Commands

**Trạng thái:** Draft

## Overview

Slash command là **shortcut do user định nghĩa** dùng trong tab Discussion / task input để chạy nhanh một hành động hoặc inject prompt template. Gõ `/` mở picker, chọn command, AWOG expand template (kèm argument) thành prompt đầy đủ và gửi vào agent đang active (hoặc trigger một tool).

Cảm hứng từ Claude Code slash commands: phương án nhanh để encapsulate "tôi luôn muốn nói X trong tình huống Y" mà không cần copy-paste hay viết skill mới.

## User Stories

- Là người dùng, tôi muốn gõ `/review` trong Discussion để gửi message "Hãy review artifact gần nhất, tìm bug…" mà không phải tự viết lại.
- Là người dùng, tôi muốn `/explain <code>` gửi code snippet vào agent kèm prompt giải thích.
- Là người dùng, tôi muốn `/refactor extract function` cho phép arg dạng free-form.
- Là người dùng, tôi muốn share command "Review PR template" với đồng đội bằng cách commit file vào workspace.
- Là người dùng, tôi muốn command `/run-tests` thực thi shell command, không cần qua agent.

## Loại command

| Loại | Hành vi | Ví dụ |
|---|---|---|
| `prompt` | Expand template → gửi như message tới agent đang active | `/review`, `/explain` |
| `agent-switch` | Đổi agent đang active sang agent khác | `/use ba` |
| `shell` | Chạy shell command, output stream vào Discussion (read-only) | `/run-tests`, `/git-status` |
| `workflow` | Trigger workflow như task mới | `/quick-fix` |

## Slash command list view

- Search box, **type filter** (prompt/agent-switch/shell/workflow).
- Item: `/<name>` (mono) + type badge + description.
- Built-in commands có badge "system" (không edit/delete được, chỉ disable).

## Slash command detail view

- `/<name>` (mono, to) + type badge.
- Description.
- Arguments schema (nếu có).
- Body (template / agent id / shell command / workflow id).
- "Try it" button — mở Discussion test.

## Slash command editor

- **Name** — auto kebab-case, prefix `/` tự thêm khi hiển thị.
- **Description** — hiển thị trong picker.
- **Type** dropdown.
- **Arguments** list:
  - `name` (positional hoặc named)
  - `type` (string / number / file / agent / artifact / boolean)
  - `required` boolean
  - `description`
- **Body** — theo type:
  - `prompt`: textarea Markdown, hỗ trợ `{{arg.name}}`, `{{context.lastArtifact}}`, `{{context.selectedText}}`.
  - `agent-switch`: dropdown chọn agent.
  - `shell`: shell command, hỗ trợ `{{arg.name}}`, `${workspace}`. Field `timeoutMs`.
  - `workflow`: dropdown chọn workflow + map argument vào input của workflow.
- **Scope** — `global` (mọi task) / `project:<id>` (chỉ project cụ thể) / `agent:<id>` (chỉ khi agent đang active).
- **Aliases** — list slug khác cũng trigger command này, ví dụ `/r` → `/review`.

## Thuộc tính Slash Command

| Field | Kiểu | Mô tả |
|---|---|---|
| `id` | string | Slug duy nhất, dùng làm name luôn |
| `name` | string | Tên không có `/`, ví dụ `review` |
| `aliases` | string[] | |
| `description` | string | |
| `type` | enum | `prompt` / `agent-switch` / `shell` / `workflow` |
| `args` | ArgSpec[] | |
| `body` | string \| object | Format theo type (xem dưới) |
| `scope` | enum | `global` / `project:<id>` / `agent:<id>` |
| `timeoutMs` | number? | Chỉ cho shell, default 30000 |

### ArgSpec

```ts
type ArgSpec = {
  name: string                                       // 'target', 'file'
  type: 'string' | 'number' | 'file' | 'agent' | 'artifact' | 'boolean'
  required: boolean
  default?: string
  description: string
}
```

### Ví dụ command

```json
{
  "id": "review",
  "name": "review",
  "aliases": ["r"],
  "description": "Yêu cầu agent review artifact gần nhất",
  "type": "prompt",
  "args": [
    { "name": "focus", "type": "string", "required": false, "description": "Khía cạnh tập trung (security, perf, …)" }
  ],
  "body": "Hãy review {{context.lastArtifact.path}} với focus vào {{arg.focus | default('toàn bộ')}}. Liệt kê bug, security issue, suggestion. Format: list bullet, mỗi item có severity + file:line.",
  "scope": "global"
}
```

```json
{
  "id": "run-tests",
  "name": "run-tests",
  "description": "Chạy test suite của project",
  "type": "shell",
  "args": [],
  "body": "pnpm test",
  "scope": "project:awog-ui",
  "timeoutMs": 120000
}
```

```json
{
  "id": "quick-fix",
  "name": "quick-fix",
  "description": "Trigger quick-bug-fix workflow",
  "type": "workflow",
  "args": [
    { "name": "issue", "type": "string", "required": true, "description": "Mô tả bug" }
  ],
  "body": {
    "workflowId": "quick-bug-fix",
    "inputMap": { "issue_description": "{{arg.issue}}" }
  },
  "scope": "global"
}
```

## Picker UI

Khi user gõ `/` vào ô input Discussion:

- Dropdown xuất hiện sát caret, fuzzy filter theo `name` + `description` + `aliases`.
- Mỗi item: `/<name>` mono + type badge + description (1 dòng truncate).
- Phím tắt: `↑/↓` chọn, `Tab`/`Enter` confirm, `Esc` close.
- Sau khi chọn → command name auto-fill, caret nhảy đến arg đầu tiên.
- Arg có type `file` / `agent` / `artifact` → mở sub-picker (giống file picker IDE).
- Hover item: tooltip show preview body (markdown render) — giúp user biết command sẽ làm gì.

## Cách command chạy

### type=prompt

1. Render `body` (Mustache-style + vài helper: `default`, `escape`).
2. Resolve `{{context.*}}`:
   - `context.lastArtifact` — artifact ghi gần nhất trong phase hiện tại.
   - `context.selectedText` — text user đang chọn trong markdown editor.
   - `context.currentTask` / `context.currentPhase`.
3. Append rendered text vào Discussion như message của user.
4. Forward message vào session của agent đang active.

### type=agent-switch

1. Đổi `activeAgentId` của Discussion sang agent target.
2. Insert system message "Switched to agent X".

### type=shell

1. Render `body` (substitute `{{arg.*}}`, `${workspace}`).
2. Spawn process, capture stdout+stderr, stream vào Discussion dưới dạng output block (mono, scrollable).
3. Exit code ≠ 0 → block màu đỏ + show exit code.

### type=workflow

1. Resolve `inputMap` (substitute `{{arg.*}}`).
2. Tạo task mới với `workflowId` + inputs.
3. Insert link "Task created: <task-id>" vào Discussion.

## Built-in command (system, không xóa được)

| Name | Type | Mô tả |
|---|---|---|
| `/help` | prompt | List command available |
| `/clear` | prompt | Clear Discussion (giữ artifact) |
| `/use <agent>` | agent-switch | Đổi agent active |
| `/run <workflow>` | workflow | Trigger workflow |
| `/approve` | prompt | Approve phase hiện tại (alternative cho button) |
| `/rerun-from <phase>` | prompt | Rerun từ phase chỉ định |

System commands có thể `disable` per workspace nhưng không edit body.

## Lưu trữ dữ liệu

`workspace/commands/<command-id>.json` — một file một command.

System commands không lưu file (hard-coded trong sidecar) — nhưng nếu user disable, tạo `workspace/commands/.disabled.json` chứa list id.

## UI/UX Notes

- Setting → **Commands** section (mở ra list view).
- Trong Discussion, picker render bằng `<Teleport>` để không bị clip bởi container.
- Khi command type=shell đang chạy → spinner inline, nút "Abort" để kill process.
- Output shell rất dài → fold, "Show all" để expand.
- Command có scope `project:<id>` chỉ hiện khi user đang ở task của project đó (filter từ picker để gọn list).

## Bảo mật

- **Shell command** giống hook — chạy với quyền user, **cảnh báo trong UI** khi tạo lần đầu.
- **Template render** không eval JS — Mustache subset + whitelist helper.
- **Argument escape** khi substitute vào shell — quote bằng `shell-quote` lib, không string concat.
- **`{{context.*}}` không expose secret** — sidecar lọc, không cho command đọc `settings.json` hay env có pattern key.
- **Disable command từ file** giữ audit (config vẫn còn) thay vì xóa.

## Phụ thuộc

- [task-execution-engine](./task-execution-engine.md) — Discussion tab cho phase.
- [agent-builder](./agent-builder.md) — agent-switch ref agent.
- [workflow-builder](./workflow-builder.md) — workflow type ref workflow.
- [artifact-system](./artifact-system.md) — `context.lastArtifact`.
- [hooks](./hooks.md) — shell command có thể trigger lại hook qua side effect file.

## Out of Scope

- **Chain command** (`/cmd1 && /cmd2`) — dùng workflow nếu cần multi-step.
- **JavaScript callback in-app** — chỉ template + shell + workflow.
- **Voice trigger** — hoàn toàn out.
- **Command marketplace** — sau MVP.

## Câu hỏi mở

- Picker có nên hỗ trợ **`@`** (mention) song song với `/` (command) như Slack/Notion? Hay `/` đủ trong MVP?
- Khi rename agent/workflow, command đang ref id đó update auto hay yêu cầu user fix?
- Có nên expose command qua **CLI** (`awog run /run-tests`) cho user power dùng terminal?
- Argument type `file` / `artifact` resolve thế nào khi user gõ tay (không qua sub-picker)? Validate hay accept literal?
- Command có nên có **per-user override** khi share qua workspace? (ví dụ team chia sẻ `/review` nhưng tôi muốn body riêng).
