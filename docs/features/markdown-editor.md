# Feature: Markdown Editor (Fullscreen IDE)

**Trạng thái:** Draft

## Overview

Markdown Editor là chế độ fullscreen IDE-style để xem và sửa artifact của một task. Kiểu VS Code: file tree bên trái, code/preview ở giữa, status bar dưới cùng. Hỗ trợ markdown render + mermaid + diff viewer.

## User Stories

- Là người dùng, tôi muốn mở artifact ra fullscreen để đọc/sửa thoải mái, không bị giới hạn trong phase card.
- Là người dùng, tôi muốn switch giữa các artifact của task nhanh qua file tree.
- Là người dùng, tôi muốn xem markdown + preview side-by-side khi đang viết.

## Layout

### Top toolbar
- Back to task (mũi tên trái + tên task).
- Filename hiện tại + task ID.
- **Diff stats** khi xem patch: `+247 −12 4 files`.
- View toggle: **Code** / **Split** / **Preview**.
- Copy / Download.

### File tree sidebar (trái)
- List tất cả artifact của task.
- Click để switch — **không thoát editor**.
- Highlight artifact đang xem.

### Editor area (giữa)
- **Code pane**: line numbers cột riêng, monospace, edit trực tiếp.
- **Preview pane**: render markdown với syntax-highlighted heading colors (H1 vàng, H2 đỏ, H3 xanh — tùy theme).
- Khi mode Split → cả hai pane song song.

### Status bar (dưới cùng)
Kiểu VS Code:
```
Markdown · UTF-8 · LF · 28 lines · 135 words · 992 chars
```

## File type support

| Đuôi | Hành vi |
|---|---|
| `.md` | Code + Preview với markdown renderer + mermaid |
| `.diff` / `.patch` | DiffViewer chuyên dụng, **single pane** (không Split / Preview toggle) |
| `.yaml` / `.yml` | Editor thường với syntax highlight |

## Markdown renderer

Render đầy đủ:
- H1 / H2 / H3 với màu phân biệt theo theme.
- Code blocks với language label.
- Ordered / unordered lists.
- Blockquotes.
- **Bold**, *italic*, inline `code`, [links].
- **Mermaid diagrams** trong block ` ```mermaid ` — load mermaid library, theme-aware.

## Mermaid rendering

- Auto-detect block ` ```mermaid `.
- Load mermaid UMD từ CDN (singleton, polling check).
- Theme variables sync với theme app (dark/light).
- Diagram types hỗ trợ: component (`graph TB`), sequence, state machine (`stateDiagram-v2`), v.v.
- **Error UI** rõ ràng nếu render fail: banner đỏ + hiển thị source code.

## Phụ thuộc

- [artifact-system](./artifact-system.md)
- [theme-system](./theme-system.md) — màu sync theo theme
- Mermaid library

## Out of Scope

- LSP autocomplete.
- Multi-cursor editing.
- Find & replace cross-file.
- Edit collaborative realtime.

## Câu hỏi mở

- Có nên hỗ trợ edit `.diff` không (hay chỉ read-only)?
- Auto-save khi edit hay phải Save thủ công?
- Khi user edit artifact, có nên tạo "user edit" run version riêng để phân biệt với agent output?
