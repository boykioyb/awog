# Feature: Artifact System

**Trạng thái:** Draft

## Overview

Artifact là bộ nhớ chung giữa các agent — file thuần được version bằng Git. Mọi agent đều đọc và ghi artifact; không có gì truyền trực tiếp agent-to-agent ([ADR 0004](../decisions/0004-artifacts-as-source-of-truth.md)).

## User Stories

- Là người dùng, tôi muốn đọc đúng output của từng agent để review.
- Là người dùng, tôi muốn thấy markdown render đầy đủ kèm mermaid diagram trong tab Output, không cần mở editor.
- Là người dùng, tôi muốn xem patch dưới dạng diff viewer chuyên dụng với syntax highlight cho `+/-/@@`.
- Là người dùng, tôi muốn Git tự động track mọi thay đổi artifact.

## Định dạng được hỗ trợ

| Đuôi | Xử lý |
|---|---|
| `.md` | Markdown renderer + mermaid auto-detect |
| `.diff` / `.patch` | Diff viewer chuyên dụng (single pane, syntax highlight) |
| `.yaml` / `.yml` | Editor thường + syntax highlight |
| `.mmd` | Mermaid source — render diagram |

## Markdown renderer

- H1/H2/H3 với màu phân biệt (theme-aware).
- Code block với language label.
- Unordered / ordered list.
- Blockquote.
- **Bold**, *italic*, inline `code`, [links].
- **Mermaid diagram** auto-detect block ` ```mermaid `:
  - Component Diagram (`graph TB`)
  - Sequence Diagram
  - State Machine (`stateDiagram-v2`)
  - Theme-aware: dark/light variables.
  - Error UI rõ ràng nếu render fail (banner đỏ + source code).

## Diff viewer

- Dành cho `.diff` / `.patch`.
- Single pane (không split), không có preview.
- Syntax highlight cho `+` (xanh), `-` (đỏ), `@@` (xám).
- Hỗ trợ multi-file diff với file header.

## Versioning

- Mọi artifact ghi đều tạo Git commit.
- Lịch sử phiên bản và diff giữa các version qua Git.
- Diff viewer giữa artifact version.

## Artifact explorer

- Tree view trong sidebar của markdown editor (xem [markdown-editor](./markdown-editor.md)).
- Click switch artifact không thoát editor.

## Lưu trữ dữ liệu

- Artifact của task: `workspace/tasks/<task-id>/artifacts/`.
- Artifact shared: `workspace/artifacts/` (ngoài phạm vi task).
- `.git/` ở gốc workspace track mọi thứ.

## Phụ thuộc

- Git (yêu cầu hệ thống).
- Mermaid library (UMD bundle, theme-aware).

## Out of Scope

- Artifact binary (ảnh, PDF) — chưa hỗ trợ trong MVP.
- Collaborative editing realtime.
- LSP / autocomplete trong editor.

## Câu hỏi mở

- Artifact rất lớn (>1MB) xử lý thế nào trong context window?
- Hỗ trợ thêm định dạng nào sau MVP (JSON, TOML, XML)?
- Mermaid render server-side hay client-side?
