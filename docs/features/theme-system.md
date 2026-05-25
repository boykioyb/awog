# Feature: Theme System

**Trạng thái:** Draft

## Overview

AWOG hỗ trợ **dark** và **light** theme. Hai theme được tune riêng theo cảm quan, **không phải invert** của nhau. Mọi visual element — bao gồm mermaid diagram và scrollbar — sync màu theo theme.

## Hai theme

### Dark — phong cách Linear/GitHub
- Background base: `#0a0a0a` (deep neutral).
- Accent: white (`#fafafa`).
- Style: ưu tiên contrast cao trong neutral, không có tint màu.

### Light — phong cách Notion/Vercel
- Background base: `#fafaf9` (warm off-white, **không phải trắng thuần**).
- Accent: black (`#1c1917`).
- Style: ấm, dịu mắt cho làm việc lâu dài.

## Color token

Mỗi theme có palette riêng cho 20+ token:

- **Background**: `bg`, `bgPanel`, `bgCanvas`, `bgElevated`, `bgHover`, `bgActive`, `bgInput`, `bgRail`, `bgSubtle`
- **Border**: `border`, `borderStrong`, `borderFocus`
- **Text**: `text`, `textMuted`, `textDim`, `textFaint`
- **Accent**: `accent`, `accentHover`, `accentText`, `accentMuted`
- **Semantic**: `warning` (+bg/border), `success`, `danger` (+bg/border), `info` (+bg/border)
- **Canvas**: `dotPattern`, `edge`, `edgeActive`, `connectingEdge`
- **Syntax** cho markdown: `h1`, `h2`, `h3`, `bold`, `italic`, `code`, `link`, `listMark`, `blockquote`

## Component sync

### Mermaid diagram
Mermaid theme variables được cấu hình từ token theme app. Diagram render đúng tone với phần còn lại của UI.

### Scrollbar
Custom global scrollbar — 10px, track trong suốt, thumb mảnh với 3 trạng thái:
- **Rest**: `borderStrong`.
- **Hover**: `textDim`.
- **Active**: `textMuted`.

### Markdown renderer
Syntax color (H1 vàng/cam, H2 đỏ, H3 xanh) được tune cho từng theme — sắc thái khác nhau dark vs light.

## Theme toggle

- Nằm ở **bottom của nav rail** (icon sun/moon).
- Click switch tức thì.
- **Transition mượt** khi switch (CSS transition 200ms trên background và border).
- Persistent: lưu lựa chọn trong `settings.json`.

## Phụ thuộc

- [markdown-editor](./markdown-editor.md) — sync màu cho preview.
- [artifact-system](./artifact-system.md) — sync mermaid.

## Out of Scope (MVP)

- System theme detection (tự động theo OS dark/light mode).
- Custom theme (user-defined palette).
- High contrast / accessibility theme.

## Câu hỏi mở

- Có cần auto-detect OS theme và follow không?
- Sau MVP có cần system "color preset" để chuyển nhanh giữa nhiều flavor (ví dụ Nord, Solarized)?
