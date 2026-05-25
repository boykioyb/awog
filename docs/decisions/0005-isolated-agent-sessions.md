# 0005 — Mỗi agent có session độc lập

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-23

## Bối cảnh

Khi nhiều agent chuyên biệt chia chung một context window, các tương tác làm bẩn lẫn nhau — tiếng ồn của QA làm hỏng reasoning của architect và làm phình token cost. Tính chuyên biệt được cải thiện khi mỗi agent có state riêng, tập trung.

## Quyết định

Mỗi agent sở hữu một session độc lập lưu tại `sessions/<agent>.json`. Session chứa message history, cache định nghĩa tool, và metadata per-agent. Agent đọc input từ artifact, không đọc từ session của agent khác.

## Phương án đã cân nhắc

- **Session global chia sẻ** — Đơn giản hơn, nhưng gây context pollution và đi ngược [0004](./0004-artifacts-as-source-of-truth.md).
- **Session per-task, phù du** — Mất "kinh nghiệm" giữa các task. Để cân nhắc cho V2.

## Hệ quả

- **Tích cực:**
  - Reasoning của từng agent sạch hơn.
  - Token usage theo từng vai trò dễ dự đoán.
  - Debug dễ hơn — mở session một agent ra để xem chính xác nó đã thấy gì.
- **Tiêu cực / Trade-off:**
  - Session lớn dần theo thời gian; cần chiến lược compaction.
  - Insight giữa các agent phải đi qua artifact một cách tường minh.
- **Việc cần làm tiếp:**
  - Thiết kế cơ chế compact hoặc tóm tắt session.
  - Quyết định session là global per-agent hay per-(agent, workflow).

## Tham chiếu

- [../features/session-system.md](../features/session-system.md)
- [0004](./0004-artifacts-as-source-of-truth.md)
