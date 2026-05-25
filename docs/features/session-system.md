# Feature: Session System

**Trạng thái:** Draft

## Overview

Mỗi agent duy trì một session độc lập. Điều này tránh context pollution giữa các agent chuyên biệt và giữ token usage tập trung.

## Lợi ích

- **Giảm context pollution** — architect không bị nhiễu bởi tiếng ồn của QA.
- **Bộ nhớ độc lập** — mỗi agent có trạng thái riêng xuyên các lần chạy.
- **Chuyên biệt tốt hơn** — system prompt và lịch sử hội thoại giữ thuần theo vai trò.

## Bố cục dữ liệu

```
sessions/
├── ba.json
├── architect.json
├── developer.json
└── reviewer.json
```

## Nội dung session

- Message history riêng cho agent đó
- Trạng thái chuyên biệt theo model (ví dụ cache định nghĩa tool)
- Metadata của agent

## Phụ thuộc

- [agent-builder](./agent-builder.md)

## Câu hỏi mở

- Session theo task hay session global theo agent?
- Chiến lược cắt tỉa / compaction session?
